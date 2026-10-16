# app.py
"""
Service BOM Application - Main Application Coordinator & Server Entry Point.
Modularized via Flask Blueprints for scalable engineering architecture.

P0 安全基线：
- 会话密钥不再硬编码，改为持久化随机密钥（data/secret.key）
- 可选口令鉴权（SBOM_AUTH=auto/on/off），局域网共享时默认要求登录
- 全局异常不再把内部错误详情回显给客户端，改为日志 + 错误编号
- 限制上传体积，防止超大请求打爆内存
"""

import os
import sys
import socket
import webbrowser
import threading
from datetime import timedelta
from urllib.parse import quote
from threading import Timer

from flask import Flask, render_template, request, jsonify, redirect
from werkzeug.exceptions import HTTPException

from services.config import config, get_secret_key
from services.logging_setup import setup_logging, get_logger, new_error_id
from services.database import get_db, init_db, find_template_path, close_db
from services.importer import import_excel_sbom
from services import auth_manager
from services.backup_manager import ensure_daily_backup
from blueprints import register_blueprints
from blueprints.auth import is_authenticated

setup_logging()
logger = get_logger('sbom.app')

app = Flask(__name__)
# 【安全】密钥从环境变量或 data/secret.key 读取，首次运行自动生成并持久化
app.config['SECRET_KEY'] = get_secret_key()
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True
# 【安全】限制单次请求体积，避免超大上传打爆内存
app.config['MAX_CONTENT_LENGTH'] = config.max_content_length
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=config.session_lifetime_days)

# 注册 DB 连接自动安全回收（无论成功或异常退出，彻底杜绝死锁与连接泄露）
app.teardown_appcontext(close_db)

# 注册模块化蓝图（含 auth 蓝图）
register_blueprints(app)


# ----------------- 鉴权拦截 (方案1：轻量访问口令) -----------------
# 这些路径必须免登录，否则登录页自身及其静态资源无法加载
AUTH_EXEMPT_EXACT = {'/login', '/favicon.ico', '/api/health'}
AUTH_EXEMPT_PREFIX = ('/static/', '/api/auth/')


@app.before_request
def enforce_authentication():
    if not config.auth_required:
        return None
    if is_authenticated():
        return None

    path = request.path
    if path in AUTH_EXEMPT_EXACT or path.startswith(AUTH_EXEMPT_PREFIX):
        return None

    if path.startswith('/api/') or path.startswith('/assets/'):
        return jsonify({
            'success': False,
            'error': '未登录或登录已失效，请重新登录',
            'need_login': True
        }), 401

    target = request.full_path if request.query_string else path
    return redirect('/login?next=' + quote(target, safe='/?&=%'))


# ----------------- Health Check -----------------
@app.route('/api/health')
def health_check():
    db_ok = False
    try:
        conn = get_db()
        conn.execute('SELECT 1')
        conn.close()
        db_ok = True
    except Exception:
        pass
    return jsonify({
        'success': db_ok,
        'status': 'ok' if db_ok else 'db_unavailable',
        'auth_required': config.auth_required
    })


# ----------------- Global API Error Handlers -----------------
@app.errorhandler(HTTPException)
def handle_http_exception(e):
    if request.path.startswith('/api/'):
        if e.code == 413:
            return jsonify({
                'success': False,
                'error': f'上传文件过大，单个文件上限为 {config.upload_max_mb} MB'
            }), 413
        return jsonify({'success': False, 'error': e.description or '请求异常'}), e.code
    return e


@app.errorhandler(Exception)
def handle_general_exception(e):
    """
    【安全】不再把 str(e) 回显给客户端（原实现会泄露数据库路径、SQL 等内部信息），
    改为写入日志并返回可追溯的错误编号。
    """
    err_id = new_error_id()
    logger.exception("未处理异常 [%s] %s %s", err_id, request.method, request.path)
    if request.path.startswith('/api/'):
        return jsonify({
            'success': False,
            'error': f'服务器内部错误（错误编号 {err_id}），详情请查看 logs/app.log',
            'error_id': err_id
        }), 500
    return f"服务器内部错误（错误编号 {err_id}），详情请查看 logs/app.log", 500


# ----------------- Main View -----------------
@app.route('/')
def index():
    return render_template('index.html')


# ----------------- LAN & Network IP Helpers -----------------
def get_all_lan_ips():
    ips = []
    try:
        raw_ips = socket.gethostbyname_ex(socket.gethostname())[2]
        for ip in raw_ips:
            if not ip.startswith(('127.', '198.18.', '169.254.')):
                ips.append(ip)
    except Exception:
        pass
    return ips


def get_lan_ip():
    # 优先通过常见网关或路由检测真实的物理局域网 IP，排除 198.18.* 等代理/TUN 虚拟网卡
    for test_target in ['192.168.1.1', '192.168.0.1', '192.168.31.1', '10.0.0.1', '114.114.114.114']:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(0.2)
            s.connect((test_target, 80))
            ip = s.getsockname()[0]
            s.close()
            if ip and not ip.startswith(('127.', '198.18.', '169.254.')):
                return ip
        except Exception:
            continue
    all_ips = get_all_lan_ips()
    if all_ips:
        non_dot_one = [ip for ip in all_ips if not ip.endswith('.1')]
        if non_dot_one:
            return non_dot_one[0]
        return all_ips[0]
    return '127.0.0.1'


_init_lock = threading.Lock()
_app_initialized = False


def ensure_app_initialized():
    """保证系统初始化幂等执行（即便通过 Gunicorn / Docker 或 WSGI 导入也能自动初始化）。"""
    global _app_initialized
    with _init_lock:
        if _app_initialized:
            return
        init_db()
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT count(*) FROM projects')
        if cursor.fetchone()[0] == 0:
            default_tpl = find_template_path()
            if default_tpl and os.path.exists(default_tpl):
                logger.info("首次启动，导入默认模版: %s", default_tpl)
                try:
                    import_excel_sbom(default_tpl)
                except Exception as e:
                    logger.warning("导入初始模版提示: %s", e)
        conn.close()

        # 初始化访问口令
        auth_manager.initialize_password()

        # 每日自动完整备份（后台守护线程，不阻塞主服务）
        threading.Thread(target=ensure_daily_backup, daemon=True).start()
        _app_initialized = True


# 模块加载时预初始化
ensure_app_initialized()


def open_browser(port=8000):
    webbrowser.open(f'http://127.0.0.1:{port}')


if __name__ == '__main__':
    port = config.port
    host = config.host
    lan_ip = get_lan_ip()
    all_lan_ips = [ip for ip in get_all_lan_ips() if ip != lan_ip]
    hostname = socket.gethostname()
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    # 读取口令展示信息
    _hash, plaintext_pw, pw_source = auth_manager.initialize_password()

    print("=====================================================")
    print("  风电机组 Service BOM 已启动 [蓝图模块化架构 / 局域网共享模式]")
    print("-----------------------------------------------------")
    print(f"  * 本机访问:       http://127.0.0.1:{port}")
    if lan_ip and lan_ip != '127.0.0.1':
        print(f"  * 局域网同事访问: http://{lan_ip}:{port}")
        print(f"  * 或通过电脑名:   http://{hostname}:{port}")
    if all_lan_ips:
        other_ips_str = ", ".join(f"http://{ip}:{port}" for ip in all_lan_ips)
        print(f"  * 其他网卡访问:   {other_ips_str}")

    print("-----------------------------------------------------")
    print(f"  * 配置文件:       {config.config_file}")
    print(f"  * 监听端口:       {port}")
    print(f"  * 访问控制:       {config.auth_mode_label}")
    if config.auth_required:
        if pw_source == 'generated' and plaintext_pw:
            print(f"  * 首次登录口令:   {plaintext_pw}")
            print("                    ^ 已自动生成并保存到 data/auth.json，请告知需要访问的同事")
        elif pw_source == 'env':
            print("  * 登录口令:       由环境变量 SBOM_PASSWORD 指定")
        elif pw_source == 'config':
            print("  * 登录口令:       由 config.ini [security] admin_password 指定")
        else:
            print("  * 登录口令:       已保存在 data/auth.json（可在系统右上角修改，或删除该文件重置）")
        print("  * 免登录启动:     可在 config.ini 中设置 auth_mode = off")
    else:
        print("  * 模式说明:       当前为免登录模式，局域网所有成员可直接打开网址访问")
    print(f"  * 默认所属单位:   {config.company_default}")
    print(f"  * 默认表单编号:   {config.form_no_default}")
    print(f"  * 上传体积上限:   {config.upload_max_mb} MB")

    has_waitress = False
    try:
        import waitress  # noqa: F401
        has_waitress = True
        print(f"  * 运行引擎:       Waitress 生产级多线程服务器 ({config.threads} 线程并发)")
    except ImportError:
        print(f"  * 运行引擎:       Flask 内置开发服务器")
    print("=====================================================")

    if not config.headless and host in ['0.0.0.0', '127.0.0.1', 'localhost']:
        Timer(1.5, open_browser, args=(port,)).start()

    if has_waitress:
        import waitress
        waitress.serve(app, host=host, port=port, threads=config.threads, connection_limit=config.connection_limit)
    else:
        app.run(host=host, port=port, debug=False, threaded=True)

