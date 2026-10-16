# services/auth_manager.py
"""
Service BOM - 轻量口令鉴权管理器 (方案1)

口令来源优先级：
1. 环境变量 SBOM_PASSWORD（便于自动化部署 / 临时应急）
2. config.ini 中的 [security] admin_password（配置文件直设）
3. data/auth.json 中的 password_hash（首次启动自动生成并持久化；该目录已在 .gitignore 中）

口令以 werkzeug 的 PBKDF2 安全散列存储，不落盘明文。
另含登录失败限流（同一 IP 连续失败 6 次锁定 60 秒），抵御暴力猜测。
"""

import os
import json
import time
import secrets
import threading
from datetime import datetime

from werkzeug.security import generate_password_hash, check_password_hash

from .config import DATA_DIR, config

AUTH_FILE_PATH = os.path.join(DATA_DIR, 'auth.json')

# 去掉 0/O/1/I/L 等易混淆字符，方便工程师抄写与传达
_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
_PASSWORD_LENGTH = 10

MAX_FAILS = 6
LOCK_SECONDS = 60

_lock = threading.Lock()
_state = {
    'password_hash': None,
    'source': None,      # env / config / file / generated
    'plaintext': None,   # 仅首次自动生成时在控制台展示，不落盘
}

_fail_tracker = {}       # ip -> {'count': int, 'locked_until': float}


def _read_auth_file():
    if not os.path.exists(AUTH_FILE_PATH):
        return {}
    try:
        with open(AUTH_FILE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_auth_file(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp_path = AUTH_FILE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, AUTH_FILE_PATH)
    try:
        os.chmod(AUTH_FILE_PATH, 0o600)
    except Exception:
        pass


def _generate_plaintext_password():
    return ''.join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(_PASSWORD_LENGTH))


def initialize_password():
    """
    解析并加载当前生效口令。返回 (password_hash, plaintext_or_None, source)。
    幂等：重复调用不会覆盖已有口令。
    """
    with _lock:
        if _state['password_hash']:
            return _state['password_hash'], _state['plaintext'], _state['source']

        # 1. 环境变量优先
        env_pw = (os.environ.get('SBOM_PASSWORD') or '').strip()
        if env_pw:
            _state.update({
                'password_hash': generate_password_hash(env_pw),
                'source': 'env',
                'plaintext': env_pw,
            })
            return _state['password_hash'], _state['plaintext'], _state['source']

        # 2. 配置文件 config.ini 中的 [security] admin_password 优先
        cfg_pw = (getattr(config, 'admin_password', '') or '').strip()
        if cfg_pw:
            _state.update({
                'password_hash': generate_password_hash(cfg_pw),
                'source': 'config',
                'plaintext': cfg_pw,
            })
            return _state['password_hash'], None, 'config'

        # 3. 检查 data/auth.json 文件
        data = _read_auth_file()
        stored_hash = (data.get('password_hash') or '').strip()
        if stored_hash:
            _state.update({
                'password_hash': stored_hash,
                'source': 'file',
                'plaintext': None,
            })
            return _state['password_hash'], None, 'file'

        # 4. 首次启动自动生成随机友好的访问口令
        plain = _generate_plaintext_password()
        new_data = {
            'password_hash': generate_password_hash(plain),
            'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'note': '由系统首次启动自动生成，可在系统内修改口令，或在 config.ini [security] admin_password 中配置固定口令',
        }
        try:
            _write_auth_file(new_data)
        except Exception:
            pass
        _state.update({
            'password_hash': new_data['password_hash'],
            'source': 'generated',
            'plaintext': plain,
        })
        return _state['password_hash'], plain, 'generated'


def verify_password(password):
    """校验口令是否正确。"""
    if not _state['password_hash']:
        initialize_password()
    if not password:
        return False
    try:
        return check_password_hash(_state['password_hash'], password)
    except Exception:
        return False


def change_password(old_password, new_password):
    """
    修改口令（已禁用在线修改）。返回 (success, message)。
    """
    return False, '系统采用固定口令，不允许在线修改'



def reset_password_file(new_password=None):
    """管理员应急：直接重设口令（无需旧口令）。"""
    new_password = (new_password or '').strip() or _generate_plaintext_password()
    data = _read_auth_file()
    data['password_hash'] = generate_password_hash(new_password)
    data['updated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    _write_auth_file(data)
    with _lock:
        _state['password_hash'] = data['password_hash']
        _state['source'] = 'file'
        _state['plaintext'] = None
    return new_password


# ----------------- 登录失败限流 -----------------
def _client_ip():
    from flask import request
    try:
        return request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or (request.remote_addr or 'unknown')
    except Exception:
        return 'unknown'


def is_locked(ip=None):
    ip = ip or _client_ip()
    info = _fail_tracker.get(ip)
    if not info:
        return False
    if info.get('locked_until', 0) > time.time():
        return True
    if info.get('locked_until', 0) and info['locked_until'] <= time.time():
        _fail_tracker.pop(ip, None)
    return False


def lock_remaining_seconds(ip=None):
    ip = ip or _client_ip()
    info = _fail_tracker.get(ip) or {}
    remain = info.get('locked_until', 0) - time.time()
    return int(remain) if remain > 0 else 0


def register_failure(ip=None):
    ip = ip or _client_ip()
    info = _fail_tracker.setdefault(ip, {'count': 0, 'locked_until': 0})
    info['count'] += 1
    if info['count'] >= MAX_FAILS:
        info['locked_until'] = time.time() + LOCK_SECONDS
        info['count'] = 0
        return True
    return False


def clear_failures(ip=None):
    ip = ip or _client_ip()
    _fail_tracker.pop(ip, None)
