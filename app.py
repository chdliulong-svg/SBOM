# app.py
"""
Service BOM Application - Main Application Coordinator & Server Entry Point.
Modularized via Flask Blueprints for scalable engineering architecture.
"""

import os
import sys
import socket
import webbrowser
from threading import Timer
from flask import Flask, render_template, request, jsonify
from werkzeug.exceptions import HTTPException

from services.database import get_db, init_db, find_template_path
from services.importer import import_excel_sbom
from blueprints import register_blueprints

app = Flask(__name__)
app.config['SECRET_KEY'] = 'service-bom-secret-key-2026'
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True

# Register all modular blueprints
register_blueprints(app)


# ----------------- Global API Error Handlers -----------------
@app.errorhandler(HTTPException)
def handle_http_exception(e):
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'error': e.description or str(e)}), e.code
    return e


@app.errorhandler(Exception)
def handle_general_exception(e):
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'error': f"服务器内部错误: {str(e)}"}), 500
    raise e


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


def open_browser(port=8000):
    webbrowser.open(f'http://127.0.0.1:{port}')


if __name__ == '__main__':
    init_db()
    # If database is empty, automatically import default template
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT count(*) FROM projects')
    if cursor.fetchone()[0] == 0:
        default_tpl = find_template_path()
        if default_tpl and os.path.exists(default_tpl):
            print(f"Importing initial template from {default_tpl}...")
            import_excel_sbom(default_tpl)
    conn.close()

    port = int(os.environ.get('PORT', 8000))
    host = os.environ.get('HOST', '0.0.0.0')
    lan_ip = get_lan_ip()
    all_lan_ips = [ip for ip in get_all_lan_ips() if ip != lan_ip]
    hostname = socket.gethostname()
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
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

    # 检测运行引擎
    has_waitress = False
    try:
        import waitress
        has_waitress = True
        print(f"  * 运行引擎:       Waitress 生产级多线程服务器 (8 线程并发)")
    except ImportError:
        print(f"  * 运行引擎:       Flask 内置开发服务器")
    print("=====================================================")

    if not os.environ.get('HEADLESS') and host in ['0.0.0.0', '127.0.0.1', 'localhost']:
        Timer(1.5, open_browser, args=(port,)).start()

    if has_waitress:
        waitress.serve(app, host=host, port=port, threads=8)
    else:
        app.run(host=host, port=port, debug=False, threaded=True)
