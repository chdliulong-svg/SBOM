# services/file_utils.py
"""
Service BOM - Core File and Asset Path Utilities
Provides filesystem paths, directory structures, safe filename sanitization,
path traversal guards, and file magic byte validation.
Decoupled from Flask blueprints to prevent circular dependencies.
"""

import os
import re

# Base Directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
IMAGES_DIR = os.path.join(ASSETS_DIR, 'images')
MANUALS_DIR = os.path.join(ASSETS_DIR, 'manuals')
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
EXPORT_DIR = os.path.join(BASE_DIR, 'exports')
BACKUP_DIR = os.path.join(BASE_DIR, 'backups')
DATA_DIR = os.path.join(BASE_DIR, 'data')

for d in [IMAGES_DIR, MANUALS_DIR, UPLOAD_DIR, EXPORT_DIR, BACKUP_DIR, DATA_DIR]:
    os.makedirs(d, exist_ok=True)


# ----------------- 上传文件名安全工具 -----------------
# 只保留安全字符集，彻底阻断 ../ ..\ 盘符( C: )、UNC( \\server\share ) 等路径穿越写法
_UNSAFE_NAME_CHARS = re.compile(r'[^A-Za-z0-9._-]')
_RESERVED_WINDOWS_NAMES = {
    'CON', 'PRN', 'AUX', 'NUL',
    *(f'COM{i}' for i in range(1, 10)),
    *(f'LPT{i}' for i in range(1, 10)),
}


def sanitize_asset_name(value, max_len=80, fallback='unnamed'):
    """
    把任意用户输入（物料号、文件名）清洗为可安全用于磁盘写入的文件名主干。
    - 移除非 [A-Za-z0-9._-] 的一切字符（含反斜杠 / 冒号 / 星号等）
    - 折叠连续的点以阻断 '..' 相对路径
    - 去除首尾的点与连字符，避免隐藏文件与参数注入
    - 排除 Windows 保留设备名（CON、NUL、COM1 等）
    """
    raw = '' if value is None else str(value)
    cleaned = _UNSAFE_NAME_CHARS.sub('_', raw)
    cleaned = re.sub(r'\.{2,}', '.', cleaned)
    cleaned = cleaned.strip().strip('._-')[:max_len].strip('._-')

    if not cleaned or cleaned.upper() in _RESERVED_WINDOWS_NAMES:
        cleaned = fallback
    return cleaned


def safe_path_under(base_dir, filename):
    """
    在 base_dir 下拼接文件名，并校验解析后的真实路径仍位于 base_dir 内。
    这是防路径穿越的最后一道防线：即使上游清洗被绕过，也不会写到目录之外。
    返回规范化绝对路径；若越界则返回 None。
    """
    base_real = os.path.realpath(base_dir)
    target_real = os.path.realpath(os.path.join(base_real, filename))
    base_check = os.path.normcase(base_real)
    target_check = os.path.normcase(target_real)
    if target_check == base_check or target_check.startswith(base_check + os.sep):
        return target_real
    return None


def validate_upload_stream(file_obj, ext):
    """
    按文件真实内容（magic bytes）校验类型，不只看扩展名。
    返回 (is_valid, error_message)。
    """
    ext = (ext or '').lower()
    try:
        pos = file_obj.tell()
        file_obj.seek(0)
        head = file_obj.read(8)
        file_obj.seek(pos)
    except Exception:
        return False, '无法读取上传文件内容'

    if ext == '.pdf':
        if not head.startswith(b'%PDF-'):
            return False, '文件内容不是有效的 PDF 手册'
        return True, ''

    if ext in ('.png', '.jpg', '.jpeg', '.webp'):
        try:
            from PIL import Image
            file_obj.seek(0)
            img = Image.open(file_obj)
            img.verify()
        except Exception:
            return False, '文件内容不是有效的图片（或已损坏）'
        finally:
            try:
                file_obj.seek(pos)
            except Exception:
                pass
        return True, ''

    if ext == '.emf':
        # Windows 图元文件，Pillow 无法解析，仅按扩展名放行
        return True, ''

    return False, f'不支持的文件类型: {ext}'


def safe_upload_temp_name(prefix, original_filename, default_ext='.xlsx'):
    """生成基于 UUID 的安全临时文件名，隔离用户输入路径与特殊字符"""
    import time
    import uuid
    from werkzeug.utils import secure_filename
    cleaned = secure_filename(original_filename or '')
    _, ext = os.path.splitext(cleaned)
    if not ext:
        ext = default_ext
    safe_prefix = re.sub(r'[^a-zA-Z0-9_-]', '_', str(prefix or 'tmp'))
    return f"{safe_prefix}_{int(time.time())}_{uuid.uuid4().hex[:10]}{ext.lower()}"


def parse_safe_xml(xml_bytes, max_bytes=32 * 1024 * 1024):
    """安全解析 XML 字节流，拒绝 DTD / ENTITY 声明并限制大小以防御 XXE 与实体膨胀攻击"""
    import re
    import xml.etree.ElementTree as ET
    if isinstance(xml_bytes, str):
        xml_bytes = xml_bytes.encode('utf-8')
    if len(xml_bytes) > max_bytes:
        raise ValueError(f'XML 文件过大 ({len(xml_bytes)} bytes)，超出安全解析上限')
    if re.search(rb'<!\s*(?:DOCTYPE|ENTITY)\b', xml_bytes, re.IGNORECASE):
        raise ValueError('检测到不安全的 XML DTD/ENTITY 声明，已拒绝解析')
    return ET.fromstring(xml_bytes)
