# blueprints/auth.py
"""
Service BOM - 认证与登录兼容路由

登录保护已永久移除。保留此蓝图端点以兼容可能存在的旧链接或状态探测请求，
所有请求均视为已认证，登录页直接重定向至首页。
"""

from flask import Blueprint, jsonify, redirect

from services.config import config
from services.logging_setup import get_logger

logger = get_logger('sbom.auth')

auth_bp = Blueprint('auth', __name__)


def is_authenticated():
    return True


def mark_authenticated():
    pass


def clear_authenticated():
    pass


@auth_bp.route('/login')
def login_page():
    return redirect('/')


@auth_bp.route('/api/auth/status', methods=['GET'])
def auth_status():
    return jsonify({
        'success': True,
        'required': False,
        'authenticated': True,
        'mode': 'off',
        'mode_label': config.auth_mode_label,
    })


@auth_bp.route('/api/auth/login', methods=['POST'])
def api_login():
    return jsonify({'success': True, 'message': '系统已永久关闭登录保护，直接访问'})


@auth_bp.route('/api/auth/logout', methods=['POST'])
def api_logout():
    return jsonify({'success': True, 'message': '系统为免登录模式'})


@auth_bp.route('/api/auth/change_password', methods=['POST'])
def api_change_password():
    return jsonify({'success': False, 'error': '系统已永久关闭登录保护，无需设置口令'}), 400
