# services/auth_manager.py
"""
Service BOM - 轻量口令鉴权管理器

设计目标：在不引入完整用户体系的前提下，堵住"局域网内任何人可清空物料主库"的风险。

口令来源优先级：
1. 环境变量 SBOM_PASSWORD（便于自动化部署 / 临时应急）
2. data/auth.json 中的 password_hash（首次启动自动生成并持久化；该目录已 gitignore）

口令以 werkzeug 的 PBKDF2 哈希存储，任何情况下都不保存明文。
另含登录失败限流（同一 IP 连续失败 6 次锁定 60 秒），抵御暴力猜测。
"""

import os
import json
import time
import secrets
import threading
from datetime import datetime

from werkzeug.security import generate_password_hash, check_password_hash

from .config import DATA_DIR

AUTH_FILE_PATH = os.path.join(DATA_DIR, 'auth.json')

# 去掉 0/O/1/I/L 等易混淆字符，方便工程师在终端抄写后口头传达
_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
_PASSWORD_LENGTH = 10

MAX_FAILS = 6
LOCK_SECONDS = 60

_lock = threading.Lock()
_state = {
    'password_hash': None,
    'source': None,      # env / file / generated
    'plaintext': None,   # 仅首次自动生成时为展示给管理员，不落盘
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

        env_pw = (os.environ.get('SBOM_PASSWORD') or '').strip()
        if env_pw:
            _state.update({
                'password_hash': generate_password_hash(env_pw),
                'source': 'env',
                'plaintext': env_pw,
            })
            return _state['password_hash'], _state['plaintext'], _state['source']

        data = _read_auth_file()
        stored_hash = (data.get('password_hash') or '').strip()
        if stored_hash:
            _state.update({
                'password_hash': stored_hash,
                'source': 'file',
                'plaintext': None,
            })
            return _state['password_hash'], None, 'file'

        plain = _generate_plaintext_password()
        new_data = {
            'password_hash': generate_password_hash(plain),
            'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'updated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'note': '由系统首次启动自动生成，请使用 SBOM_PASSWORD 环境变量或登录后修改',
        }
        try:
            _write_auth_file(new_data)
        except Exception:
            # 写不进去也要能启动，此时口令仅本次有效
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
    修改口令。返回 (success, message)。
    口令来自环境变量时不接受在线修改（避免与部署配置冲突）。
    """
    if _state.get('source') == 'env':
        return False, '当前口令由环境变量 SBOM_PASSWORD 指定，请修改环境变量后重启服务'

    if not verify_password(old_password):
        return False, '当前口令不正确'

    new_password = (new_password or '').strip()
    if len(new_password) < 6:
        return False, '新口令长度至少 6 位'

    data = _read_auth_file()
    data['password_hash'] = generate_password_hash(new_password)
    data['updated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    data.pop('note', None)
    _write_auth_file(data)

    with _lock:
        _state['password_hash'] = data['password_hash']
        _state['source'] = 'file'
        _state['plaintext'] = None
    return True, '口令已更新，请牢记新口令'


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
