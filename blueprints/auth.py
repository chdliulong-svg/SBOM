# blueprints/auth.py
"""
Service BOM - 登录鉴权路由蓝图 (方案1：轻量访问口令)

提供登录页渲染、登录/登出/会话状态探测/修改访问口令等功能。
鉴权拦截统一置于 app.py 的 before_request 钩子中，本蓝图端点全部免鉴权。
"""

from flask import Blueprint, request, jsonify, render_template, session, redirect

from services.config import config
from services import auth_manager
from services.logging_setup import get_logger

logger = get_logger('sbom.auth')

auth_bp = Blueprint('auth', __name__)

SESSION_KEY = 'sbom_authenticated'


def is_authenticated():
    """判断当前请求是否已通过口令验证。"""
    if not config.auth_required:
        return True
    return bool(session.get(SESSION_KEY))


def mark_authenticated():
    """将当前会话标记为已认证。"""
    session[SESSION_KEY] = True
    session.permanent = True


def clear_authenticated():
    """清除当前会话的认证标记。"""
    session.pop(SESSION_KEY, None)


@auth_bp.route('/login')
def login_page():
    """登录页面。若无需登录或已登录，直接跳转目标页面或首页。"""
    next_url = request.args.get('next', '/')
    if not config.auth_required or is_authenticated():
        return redirect(next_url if next_url.startswith('/') else '/')

    return render_template(
        'login.html',
        auth_mode=config.auth_mode,
        auth_mode_label=config.auth_mode_label,
        next_url=next_url
    )


@auth_bp.route('/api/auth/status', methods=['GET'])
def auth_status():
    """获取当前鉴权配置及会话登录状态。"""
    return jsonify({
        'success': True,
        'required': config.auth_required,
        'authenticated': is_authenticated(),
        'mode': config.auth_mode,
        'mode_label': config.auth_mode_label,
    })


@auth_bp.route('/api/auth/login', methods=['POST'])
def api_login():
    """口令登录验证。"""
    data = request.get_json(silent=True) or {}
    password = (data.get('password') or '').strip()

    if not config.auth_required:
        mark_authenticated()
        return jsonify({'success': True, 'message': '当前为免登录模式'})

    if auth_manager.is_locked():
        remain = auth_manager.lock_remaining_seconds()
        return jsonify({
            'success': False,
            'error': f'口令错误次数过多，已被系统临时锁定，请等待 {remain} 秒后重试'
        }), 429

    if auth_manager.verify_password(password):
        auth_manager.clear_failures()
        mark_authenticated()
        logger.info("用户登录成功 (客户端 IP: %s)", request.remote_addr)
        return jsonify({'success': True, 'message': '登录成功'})

    locked = auth_manager.register_failure()
    logger.warning("用户登录失败 (客户端 IP: %s, 是否触发锁定: %s)", request.remote_addr, locked)
    if locked:
        return jsonify({
            'success': False,
            'error': f'口令连续输入错误达上限，已临时锁定 {auth_manager.LOCK_SECONDS} 秒'
        }), 429

    return jsonify({'success': False, 'error': '访问口令不正确，请重新输入'}), 401


@auth_bp.route('/api/auth/logout', methods=['POST'])
def api_logout():
    """退出登录并清理会话。"""
    clear_authenticated()
    return jsonify({'success': True, 'message': '已安全退出登录'})


@auth_bp.route('/api/auth/change_password', methods=['POST'])
def api_change_password():
    """修改系统访问口令。"""
    if config.auth_required and not is_authenticated():
        return jsonify({'success': False, 'error': '请先登录后再修改口令'}), 401

    data = request.get_json(silent=True) or {}
    old_pw = (data.get('old_password') or '').strip()
    new_pw = (data.get('new_password') or '').strip()

    if not old_pw:
        return jsonify({'success': False, 'error': '请输入当前原口令'}), 400
    if not new_pw:
        return jsonify({'success': False, 'error': '请输入新口令'}), 400

    ok, msg = auth_manager.change_password(old_pw, new_pw)
    if not ok:
        return jsonify({'success': False, 'error': msg}), 400

    logger.info("系统访问口令已成功更新 (客户端 IP: %s)", request.remote_addr)
    return jsonify({'success': True, 'message': msg})
