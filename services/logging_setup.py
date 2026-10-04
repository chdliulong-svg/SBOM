# services/logging_setup.py
"""
Service BOM - 统一日志基础设施

替代原先散落全项目的 print()：所有异常与关键操作进入 logs/app.log（按大小轮转），
控制台仅输出启动横幅与警告及以上级别，避免刷屏。
"""

import os
import logging
import uuid
from logging.handlers import RotatingFileHandler

from .config import LOG_DIR

_CONFIGURED = False


def setup_logging(level=logging.INFO):
    """配置根 logger：控制台 + 轮转文件。可重复调用，幂等。"""
    global _CONFIGURED
    if _CONFIGURED:
        return logging.getLogger('sbom')

    os.makedirs(LOG_DIR, exist_ok=True)
    logger = logging.getLogger('sbom')
    logger.setLevel(level)
    logger.propagate = False

    fmt = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    file_handler = RotatingFileHandler(
        os.path.join(LOG_DIR, 'app.log'),
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(level)
    logger.addHandler(file_handler)

    console = logging.StreamHandler()
    console.setFormatter(fmt)
    console.setLevel(logging.WARNING)
    logger.addHandler(console)

    # 收敛第三方库噪声
    for noisy in ('werkzeug', 'waitress'):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    _CONFIGURED = True
    return logger


def get_logger(name='sbom'):
    if not _CONFIGURED:
        setup_logging()
    return logging.getLogger(name)


def new_error_id():
    """生成短错误 ID，用于前端展示与日志定位的关联。"""
    return uuid.uuid4().hex[:8]
