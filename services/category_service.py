# services/category_service.py
"""
Service BOM - 系统分类管理与扩展服务
支持内置分类（变桨系统、变流器系统）与未来任意自定义系统分类（主控、偏航、发电机等）的动态管理与状态维护。
"""

import re
from services.database import get_db
from services.logging_setup import get_logger

logger = get_logger('sbom.category')


def list_categories(include_inactive=False):
    """
    获取所有系统分类列表，附带各分类下工程项目的统计数量。
    默认仅返回启用的分类，按 sort_order 升序及 code 排序。
    """
    conn = get_db()
    cursor = conn.cursor()
    try:
        where_clause = "" if include_inactive else "WHERE c.is_active = 1"
        cursor.execute(f'''
            SELECT 
                c.code,
                c.name,
                c.short_name,
                c.default_system_name,
                c.icon,
                c.sort_order,
                c.is_active,
                c.is_system,
                c.description,
                c.created_at,
                COUNT(p.id) AS project_count
            FROM system_categories c
            LEFT JOIN projects p ON p.category = c.code
            {where_clause}
            GROUP BY c.code
            ORDER BY c.sort_order ASC, c.code ASC
        ''')
        rows = [dict(r) for r in cursor.fetchall()]
        return rows
    finally:
        pass


def get_category(code: str):
    """获取单个分类的详情。"""
    if not code:
        return None
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT 
            c.code,
            c.name,
            c.short_name,
            c.default_system_name,
            c.icon,
            c.sort_order,
            c.is_active,
            c.is_system,
            c.description,
            c.created_at,
            COUNT(p.id) AS project_count
        FROM system_categories c
        LEFT JOIN projects p ON p.category = c.code
        WHERE c.code = ?
        GROUP BY c.code
    ''', (code.strip(),))
    row = cursor.fetchone()
    return dict(row) if row else None


def get_category_default_system_name(category_code: str) -> str:
    """根据分类代码快速获取其新建工程时的默认部套/系统名称。"""
    cat = get_category(category_code)
    if cat and cat.get('default_system_name'):
        return cat['default_system_name'].strip()
    if cat and cat.get('name'):
        return cat['name'].strip()
    return '变桨系统' if category_code == 'pitch' else '变流器系统' if category_code == 'converter' else '部套系统'


def create_category(code: str, name: str, short_name: str = '', default_system_name: str = '',
                    icon: str = '📁', sort_order: int = 0, description: str = ''):
    """
    创建新的系统分类（预留未来增加分类的核心能力）。
    code 必须由英文字母、数字或下划线组成，唯一且非空。
    """
    code = (code or '').strip().lower()
    name = (name or '').strip()
    short_name = (short_name or name[:4]).strip()
    default_system_name = (default_system_name or name).strip()
    icon = (icon or '📁').strip()

    if not code:
        return False, "分类代码不能为空"
    if not re.match(r'^[a-z0-9_]{2,30}$', code):
        return False, "分类代码必须为 2~30 位的英文字母、数字或下划线（小写）"
    if not name:
        return False, "分类名称不能为空"

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT code FROM system_categories WHERE code = ?", (code,))
        if cursor.fetchone():
            return False, f"分类代码 '{code}' 已存在，请更换代码"

        cursor.execute('''
            INSERT INTO system_categories (code, name, short_name, default_system_name, icon, sort_order, is_active, is_system, description)
            VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
        ''', (code, name, short_name, default_system_name, icon, int(sort_order or 0), description))
        conn.commit()
        logger.info("已新增自定义系统分类: code=%s, name=%s", code, name)
        return True, get_category(code)
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.exception("创建分类失败: %s", str(e))
        return False, f"创建分类失败: {str(e)}"


def update_category(code: str, data: dict):
    """
    更新系统分类配置。
    若为内置分类（is_system=1），不允许修改 code 或停用核心分类。
    """
    code = (code or '').strip().lower()
    cat = get_category(code)
    if not cat:
        return False, "未找到该分类"

    name = (data.get('name') or cat['name']).strip()
    short_name = (data.get('short_name') or cat['short_name']).strip()
    default_system_name = (data.get('default_system_name') or cat['default_system_name']).strip()
    icon = (data.get('icon') or cat['icon']).strip()
    sort_order = int(data.get('sort_order', cat['sort_order']) or 0)
    is_active = 1 if data.get('is_active', cat['is_active']) in (1, '1', True, 'true') else 0
    description = data.get('description', cat['description'])

    if not name:
        return False, "分类名称不能为空"

    # 内置核心分类不能被停用
    if cat['is_system'] == 1 and is_active == 0:
        return False, "系统内置基础分类不可停用"

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            UPDATE system_categories
            SET name = ?, short_name = ?, default_system_name = ?, icon = ?, sort_order = ?, is_active = ?, description = ?
            WHERE code = ?
        ''', (name, short_name, default_system_name, icon, sort_order, is_active, description, code))
        conn.commit()
        return True, get_category(code)
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return False, f"更新分类失败: {str(e)}"


def delete_category(code: str):
    """
    删除自定义分类。
    内置系统分类不可删除；已有工程关联的分类不可删除（保护数据完整性）。
    """
    code = (code or '').strip().lower()
    cat = get_category(code)
    if not cat:
        return False, "未找到该分类"
    if cat['is_system'] == 1:
        return False, "系统内置基础分类不可删除"

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM projects WHERE category = ?", (code,))
        proj_count = cursor.fetchone()[0]
        if proj_count > 0:
            return False, f"该分类下已有 {proj_count} 个工程项目，无法删除！如不再使用可选择停用该分类。"

        cursor.execute("DELETE FROM system_categories WHERE code = ?", (code,))
        conn.commit()
        logger.info("已删除自定义系统分类: code=%s", code)
        return True, "分类已成功删除"
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return False, f"删除分类失败: {str(e)}"
