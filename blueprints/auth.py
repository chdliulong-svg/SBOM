# blueprints/auth.py
"""
Service BOM - 登录鉴权接口

提供登录页、登录/登出/状态查询/修改口令接口。
拦截逻辑统一放在 app.py 的 before_request 钩子中，此处路由全部免鉴权。
"""

from flask import Blueprint, request, jsonify, render_template, session

from services.config import config
from services import auth_manager
from services.logging_setup import get_logger

logger = get_logger('sbom.auth')

auth_bp = Blueprint('auth', __name__)

SESSION_KEY = 'sbom_authenticated'
SESSION_AT_KEY = 'sbom_auth_at'


def is_authenticated():
    return bool(session.get(SESSION_KEY))


def mark_authenticated():
    session[SESSION_KEY] = True
    session.permanent = True


def clear_authenticated():
    session.pop(SESSION_KEY, None)
    session.pop(SESSION_AT_KEY, None)


@auth_bp.route('/login')
def login_page():
    if not config.auth_required:
        # 未启用鉴权时访问登录页没有意义，直接回首页
        from flask import redirect
        return redirect('/')
    return render_template(
        'login.html',
        auth_mode=config.auth_mode,
        auth_mode_label=config.auth_mode_label,
        next_url=request.args.get('next', '/')
    )


@auth_bp.route('/api/auth/status', methods=['GET'])
def auth_status():
    return jsonify({
        'success': True,
        'required': config.auth_required,
        'authenticated': is_authenticated(),
        'mode': config.auth_mode,
        'mode_label': config.auth_mode_label,
    })


@auth_bp.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    password = (data.get('password') or '').strip()

    if not config.auth_required:
        mark_authenticated()
        return jsonify({'success': True, 'message': '当前为免登录模式'})

    if auth_manager.is_locked():
        remain = auth_manager.lock_remaining_seconds()
        return jsonify({
            'success': False,
            'error': f'登录失败次数过多，请等待 {remain} 秒后重试'
        }), 429

    if auth_manager.verify_password(password):
        auth_manager.clear_failures()
        mark_authenticated()
        logger.info("用户登录成功 (IP: %s)", request.remote_addr)
        return jsonify({'success': True, 'message': '登录成功'})

    locked = auth_manager.register_failure()
    logger.warning("用户登录失败 (IP: %s, 触发锁定: %s)", request.remote_addr, locked)
    if locked:
        return jsonify({
            'success': False,
            'error': f'口令错误次数过多，已锁定 {auth_manager.LOCK_SECONDS} 秒'
        }), 429
    return jsonify({'success': False, 'error': '口令不正确，请重新输入'}), 401


@auth_bp.route('/api/auth/logout', methods=['POST'])
def api_logout():
    clear_authenticated()
    return jsonify({'success': True, 'message': '已安全退出登录'})


@auth_bp.route('/api/auth/change_password', methods=['POST'])
def api_change_password():
    if config.auth_required and not is_authenticated():
        return jsonify({'success': False, 'error': '请先登录'}), 401

    data = request.get_json(silent=True) or {}
    ok, msg = auth_manager.change_password(
        (data.get('old_password') or '').strip(),
        (data.get('new_password') or '')
    )
    if not ok:
        return jsonify({'success': False, 'error': msg}), 400
    logger.info("系统访问口令已更新")
    return jsonify({'success': True, 'message': msg})
