# blueprints/common.py
"""
Common utilities, directory paths, and database helpers shared across blueprints.
"""

import os
from services.database import get_db

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


def check_project_unlocked(project_id=None, subsystem_id=None, bom_item_id=None):
    """
    Checks if the project associated with the given project_id, subsystem_id,
    or bom_item_id is unlocked (is_locked == 0).
    Returns (True, None) if allowed, or (False, error_message) if locked.
    """
    conn = get_db()
    cursor = conn.cursor()
    try:
        if bom_item_id:
            cursor.execute('''
                SELECT p.id, p.code, p.system_name, p.name, p.is_locked
                FROM bom_items b
                JOIN subsystems s ON b.subsystem_id = s.id
                JOIN projects p ON s.project_id = p.id
                WHERE b.id = ?
            ''', (bom_item_id,))
        elif subsystem_id:
            cursor.execute('''
                SELECT p.id, p.code, p.system_name, p.name, p.is_locked
                FROM subsystems s
                JOIN projects p ON s.project_id = p.id
                WHERE s.id = ?
            ''', (subsystem_id,))
        elif project_id:
            cursor.execute('SELECT id, code, system_name, name, is_locked FROM projects WHERE id = ?', (project_id,))
        else:
            return True, None

        row = cursor.fetchone()
        if not row:
            return False, "未找到关联的项目工程"
        if row['is_locked'] == 1:
            name = row['system_name'] or row['code'] or row['name'] or '该工程'
            return False, f"工程【{name}】当前处于【锁定保护】状态，禁止修改！如需编辑请先在顶部操作栏点击【解锁】。"
        return True, None
    finally:
        conn.close()


def compute_bom_hierarchy_numbers(items, mode='dotted'):
    """
    Computes hierarchical sequence numbers (seq_num) and 1-based sequential row numbers.
    items: list of dicts with 'level_num' or 'level_str'.
    mode: 'dotted' -> '1', '1.1', '1.2', '1.2.1'...
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

        if mode == 'dotted':
            seq_val = '.'.join(str(c) for c in counters)
        else:
            seq_val = str(counters[effective_lvl - 1])

        results.append((row_num, seq_val))

    return results


def renumber_subsystem(cursor, subsystem_id, mode='dotted'):
    """
    Renumbers:
    - row_num sequentially (1, 2, 3...)
    - seq_num hierarchically by tree depth (1, 1.1, 1.2, 1.2.1...)
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
    for (row_num, seq_num), r in zip(computed, rows):
        cursor.execute('UPDATE bom_items SET row_num = ?, seq_num = ? WHERE id = ?',
                       (row_num, str(seq_num), r['id']))


def upsert_material(cursor, material_no, name='', description='', spec_model='', manufacturer='', unit='PCS', drawing_no='', notes='', substitute='', remove_image=False, remove_manual=False):
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
    ''', (material_no, name, description, spec_model, manufacturer, unit or 'PCS', drawing_no or '/', notes, substitute))

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
