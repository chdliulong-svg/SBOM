# services/time_utils.py
"""
Service BOM - 统一北京时间 (UTC+8 / Asia/Shanghai) 工具模块。
确保系统所有时间读写不依赖宿主机或容器操作系统时区，始终严格按北京时间执行。
"""

from datetime import datetime, timedelta, timezone

BEIJING_TZ = timezone(timedelta(hours=8))
SQLITE_BEIJING_NOW = "datetime('now', '+8 hours')"


def beijing_now() -> datetime:
    """
    返回当前北京时间 (UTC+8) 的 naive datetime。
    用于与 SQLite datetime('now', '+8 hours') 存储的时间字符串安全比对或格式化。
    """
    return datetime.now(BEIJING_TZ).replace(tzinfo=None)


def beijing_now_str(fmt: str = '%Y-%m-%d %H:%M:%S') -> str:
    """按指定格式返回当前北京时间字符串。"""
    return beijing_now().strftime(fmt)


def beijing_now_iso() -> str:
    """返回包含 +08:00 时区偏移的 ISO-8601 北京时间字符串。"""
    return datetime.now(BEIJING_TZ).isoformat()
