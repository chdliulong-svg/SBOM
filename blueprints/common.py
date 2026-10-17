# blueprints/common.py
"""
Common utilities, directory paths, and database helpers shared across blueprints.
"""

import os
import re
from datetime import datetime
from flask import has_request_context, request
from services.database import get_db

from services.file_utils import (
    BASE_DIR,
    ASSETS_DIR,
    IMAGES_DIR,
    MANUALS_DIR,
    UPLOAD_DIR,
    EXPORT_DIR,
    BACKUP_DIR,
    DATA_DIR,
    sanitize_asset_name,
    safe_path_under,
    validate_upload_stream
)


# ----------------- 协同锁与用户身份工具 -----------------
def get_client_identity():
    """以客户端 IP 地址作为协同身份标识"""
    if has_request_context():
        return request.headers.get('X-Forwarded-For', request.remote_addr or '127.0.0.1').split(',')[0].strip()
    return '127.0.0.1'


def check_and_expire_lease(cursor, project_row):
    """
    检查租约是否已过期（默认 180 秒无心跳）。
    如果已过期，自动设为锁定并释放占用，避免工程师死机/断线后永久死锁。
    返回最新的 (is_locked, locked_by)。
    """
    if not project_row:
        return 1, ''
    if project_row['is_locked'] == 1:
        return 1, ''
    locked_at_str = project_row['locked_at']
    if not locked_at_str:
        return 0, project_row['locked_by'] or ''
    try:
        t_str = str(locked_at_str).split('.')[0]
        locked_time = datetime.strptime(t_str, '%Y-%m-%d %H:%M:%S')
        now = datetime.now()
        if (now - locked_time).total_seconds() > 180:
            cursor.execute("UPDATE projects SET is_locked = 1, locked_by = '', locked_at = NULL WHERE id = ?", (project_row['id'],))
            if hasattr(cursor, 'connection') and cursor.connection:
                try:
                    cursor.connection.commit()
                except Exception:
                    pass
            return 1, ''
    except Exception:
        pass
    return project_row['is_locked'], project_row['locked_by'] or ''


def check_project_unlocked(project_id=None, subsystem_id=None, bom_item_id=None, conn=None):
    """
    Checks if the project associated with the given project_id, subsystem_id,
    or bom_item_id is unlocked (is_locked == 0).
    自动处理租约过期，并校验操作者身份（防止越权修改他人占用的工程）。
    Returns (True, None) if allowed, or (False, error_message) if locked or occupied.
    """
    should_close = False
    if conn is None:
        if has_request_context():
            conn = get_db()
            should_close = False
        else:
            conn = get_db()
            should_close = True
    cursor = conn.cursor()
    try:
        if bom_item_id:
            cursor.execute('''
                SELECT p.id, p.code, p.system_name, p.name, p.is_locked, p.locked_by, p.locked_at
                FROM bom_items b
                JOIN subsystems s ON b.subsystem_id = s.id
                JOIN projects p ON s.project_id = p.id
                WHERE b.id = ?
            ''', (bom_item_id,))
        elif subsystem_id:
            cursor.execute('''
                SELECT p.id, p.code, p.system_name, p.name, p.is_locked, p.locked_by, p.locked_at
                FROM subsystems s
                JOIN projects p ON s.project_id = p.id
                WHERE s.id = ?
            ''', (subsystem_id,))
        elif project_id:
            cursor.execute('SELECT id, code, system_name, name, is_locked, locked_by, locked_at FROM projects WHERE id = ?', (project_id,))
        else:
            return True, None

        row = cursor.fetchone()
        if not row:
            return False, "未找到关联的项目工程"

        # 1. 自动检测并回收超时租约
        curr_locked, curr_user = check_and_expire_lease(cursor, row)
        name = row['system_name'] or row['code'] or row['name'] or '该工程'

        if curr_locked == 1:
            return False, f"工程【{name}】当前处于【锁定保护】状态，禁止修改！如需编辑请先在顶部操作栏点击【解锁】。"

        # 2. 校验占用人身份与当前客户端身份是否一致
        if has_request_context():
            client_id = get_client_identity()
            if curr_user and curr_user != client_id:
                return False, f"工程【{name}】当前正由同事 [{curr_user}] 在编辑中，禁止跨用户直接修改！若需编辑请先在顶部点击【解锁/接管编辑】。"

        return True, None
    finally:
        if should_close:
            try:
                conn.close()
            except Exception:
                pass


def compute_bom_hierarchy_numbers(items, mode='step10'):
    """
    Computes hierarchical sequence numbers (seq_num) and 1-based sequential row numbers.
    items: list of dicts with 'level_num' or 'level_str'.
    mode: 'step10' -> 10, 20, 30... for each hierarchy level (V2 模版规范：每个层级序号从10开始递增)
          'dotted' -> '1', '1.1', '1.2', '1.2.1'...
          'single' -> '1', '1', '2', '1'...
    """
    parsed_levels = []
    for it in items:
        lvl = it.get('level_num')
        if lvl is None or lvl == '' or lvl == 0:
            lvl_str = str(it.get('level_str') or '')
            if '•' in lvl_str:
                lvl = lvl_str.count('•')
            elif '.' in lvl_str:
                digits = [c for c in lvl_str if c.isdigit()]
                lvl = int(digits[0]) if digits else 2
            else:
                lvl = 2
        else:
            lvl = int(lvl)
        lvl = max(1, lvl)
        parsed_levels.append(lvl)

    min_lvl = min(parsed_levels) if parsed_levels else 1
    base_offset = (min_lvl - 1) if min_lvl > 1 else 0

    counters = []
    results = []

    for idx, (it, raw_lvl) in enumerate(zip(items, parsed_levels)):
        row_num = idx + 1
        effective_lvl = max(1, raw_lvl - base_offset)

        while len(counters) < effective_lvl:
            counters.append(0)
        counters = counters[:effective_lvl]
        counters[effective_lvl - 1] += 1

        if mode == 'step10':
            seq_val = str(counters[effective_lvl - 1] * 10)
        elif mode == 'dotted':
            seq_val = '.'.join(str(c) for c in counters)
        else:
            seq_val = str(counters[effective_lvl - 1])

        results.append((row_num, seq_val))

    return results


def renumber_subsystem(cursor, subsystem_id, mode='step10'):
    """
    Renumbers:
    - row_num sequentially (1, 2, 3...)
    - seq_num hierarchically by tree depth (V2 模版：每层从10递增: 10, 20, 30...)
    使用 executemany 批量更新替代循环逐条 UPDATE，大幅降低事务与游标开销。
    """
    cursor.execute('''
    SELECT id, level_num, level_str, parent_material_no
    FROM bom_items
    WHERE subsystem_id = ?
    ORDER BY row_num, id
    ''', (subsystem_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    if not rows:
        return

    computed = compute_bom_hierarchy_numbers(rows, mode=mode)
    update_data = [(row_num, str(seq_num), r['id']) for (row_num, seq_num), r in zip(computed, rows)]
    cursor.executemany('UPDATE bom_items SET row_num = ?, seq_num = ? WHERE id = ?', update_data)


def upsert_material(cursor, material_no, name='', description='', spec_model='', manufacturer='', unit='PC', drawing_no='', notes='', substitute='', remove_image=False, remove_manual=False):
    """
    Ensure material exists in materials master table and sync its master metadata.
    If the material is new, it is inserted into the database.
    If it exists, any non-empty attributes provided are updated.
    """
    cursor.execute('''
    INSERT INTO materials (material_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(material_no) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE materials.name END,
        description = CASE WHEN excluded.description != '' THEN excluded.description ELSE materials.description END,
        spec_model = CASE WHEN excluded.spec_model != '' THEN excluded.spec_model ELSE materials.spec_model END,
        manufacturer = CASE WHEN excluded.manufacturer != '' THEN excluded.manufacturer ELSE materials.manufacturer END,
        unit = CASE WHEN excluded.unit != '' THEN excluded.unit ELSE materials.unit END,
        drawing_no = CASE WHEN excluded.drawing_no != '' AND excluded.drawing_no != '/' THEN excluded.drawing_no ELSE materials.drawing_no END,
        notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE materials.notes END,
        substitute = CASE WHEN excluded.substitute != '' THEN excluded.substitute ELSE materials.substitute END
    ''', (material_no, name, description, spec_model, manufacturer, unit or 'PC', drawing_no or '/', notes, substitute))

    if remove_image:
        cursor.execute('UPDATE materials SET image_path = "" WHERE material_no = ?', (material_no,))
    if remove_manual:
        cursor.execute('UPDATE materials SET manual_path = "" WHERE material_no = ?', (material_no,))


def get_subtree_block_indices(items, start_idx):
    """
    Returns start_idx, end_idx representing the entire subtree rooted at items[start_idx].
    Includes start_idx and all subsequent items with level_num > items[start_idx]['level_num'].
    """
    root_lvl = items[start_idx]['level_num'] or 2
    end_idx = start_idx + 1
    while end_idx < len(items) and (items[end_idx]['level_num'] or 2) > root_lvl:
        end_idx += 1
    return start_idx, end_idx
