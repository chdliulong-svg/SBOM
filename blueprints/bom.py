# blueprints/bom.py
"""
BOM Items CRUD, Tree Structure, Reordering & Hierarchy Renumbering APIs.
"""

from flask import Blueprint, request, jsonify
from services.database import get_db, get_material_tree
from blueprints.common import (
    check_project_unlocked,
    renumber_subsystem,
    upsert_material,
    get_subtree_block_indices
)

bom_bp = Blueprint('bom', __name__)


@bom_bp.route('/api/subsystem/<int:subsystem_id>/items', methods=['GET'])
def get_bom_items(subsystem_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    SELECT b.*,
           m.drawing_no as m_drawing_no,
           m.name as m_name, m.description as m_desc, m.spec_model as m_model,
           m.manufacturer as m_mfr, m.unit as m_unit, m.image_path, m.manual_path,
           m.substitute as m_substitute
    FROM bom_items b
    LEFT JOIN materials m ON b.material_no = m.material_no
    WHERE b.subsystem_id = ?
    ORDER BY b.row_num, b.id
    ''', (subsystem_id,))
    rows = cursor.fetchall()
    items = []
    for r in rows:
        d = dict(r)
        if (not d.get('drawing_no') or d.get('drawing_no') == '/') and d.get('m_drawing_no'):
            d['drawing_no'] = d['m_drawing_no']
        items.append(d)
    conn.close()
    return jsonify(items)


@bom_bp.route('/api/bom/add', methods=['POST'])
def add_bom_item():
    data = request.json
    subsystem_id = data.get('subsystem_id')
    material_no = data.get('material_no', '').strip()
    if not subsystem_id or not material_no:
        return jsonify({'error': '缺少子系统ID或物料号'}), 400

    is_ok, err_msg = check_project_unlocked(subsystem_id=subsystem_id)
    if not is_ok:
        return jsonify({'error': err_msg}), 403

    conn = get_db()
    cursor = conn.cursor()

    # Check if this material is new to the database
    cursor.execute('SELECT material_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute FROM materials WHERE material_no = ?', (material_no,))
    existing_mat = cursor.fetchone()
    is_new = (existing_mat is None or (not existing_mat['name'] and not existing_mat['description']))

    name = (data.get('name') or data.get('m_name') or (existing_mat['name'] if existing_mat else '') or '').strip()
    description = (data.get('description') or data.get('m_desc') or (existing_mat['description'] if existing_mat else '') or '').strip()
    spec_model = (data.get('spec_model') or data.get('m_model') or (existing_mat['spec_model'] if existing_mat else '') or '').strip()
    manufacturer = (data.get('manufacturer') or data.get('m_mfr') or (existing_mat['manufacturer'] if existing_mat else '') or '').strip()
    unit = (data.get('unit') or data.get('m_unit') or (existing_mat['unit'] if existing_mat else 'PC') or 'PC').strip()
    notes = (data.get('notes') or (existing_mat['notes'] if existing_mat else '') or '').strip()
    substitute = (data.get('substitute') or (existing_mat['substitute'] if existing_mat else '') or '').strip()
    remove_image = bool(data.get('remove_image'))
    remove_manual = bool(data.get('remove_manual'))

    drawing_no = (data.get('drawing_no') or '').strip()
    if (not drawing_no or drawing_no == '/') and existing_mat and existing_mat['drawing_no'] and existing_mat['drawing_no'] != '/':
        drawing_no = existing_mat['drawing_no']
    if not drawing_no:
        drawing_no = '/'

    upsert_material(cursor, material_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute, remove_image=remove_image, remove_manual=remove_manual)

    import_children = bool(data.get('import_children'))
    children_to_import = []
    if import_children:
        children_to_import = get_material_tree(cursor, material_no)

    total_rows_to_insert = 1 + len(children_to_import)

    insert_after_row = data.get('insert_after_row')
    if insert_after_row is not None and str(insert_after_row).isdigit():
        target_row = int(insert_after_row) + 1
        cursor.execute('UPDATE bom_items SET row_num = row_num + ? WHERE subsystem_id = ? AND row_num >= ?',
                       (total_rows_to_insert, subsystem_id, target_row))
    else:
        cursor.execute('SELECT COALESCE(MAX(row_num), 0) + 1 FROM bom_items WHERE subsystem_id = ?', (subsystem_id,))
        target_row = cursor.fetchone()[0]

    parent_level_str = data.get('level_str', '•' if len(children_to_import) > 0 else '••')
    parent_level_num = int(data.get('level_num', 1 if len(children_to_import) > 0 else 2))

    # 1. Insert parent row
    cursor.execute('''
    INSERT INTO bom_items (subsystem_id, row_num, level_str, level_num, parent_material_no, seq_num, material_no, drawing_no, qty, unit, notes, substitute)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (subsystem_id, target_row, parent_level_str, parent_level_num, '',
          target_row, material_no, drawing_no,
          str(data.get('qty', '1')), unit,
          notes, substitute))

    # 2. Insert all child rows in hierarchical sequence
    for c_offset, child in enumerate(children_to_import, 1):
        c_row = target_row + c_offset
        c_mat_no = child['child_material_no']
        rel_depth = int(child.get('relative_depth') or 1)
        c_lvl_num = parent_level_num + rel_depth
        c_lvl_str = '•' * c_lvl_num
        c_dwg = child.get('drawing_no') or child.get('m_drawing_no') or '/'
        c_qty = str(child.get('qty', '1'))
        c_unit = child.get('unit') or child.get('m_unit') or 'PC'
        c_notes = child.get('notes', '')
        c_sub = child.get('substitute', '')
        c_parent = child.get('parent_material_no') or material_no

        cursor.execute('''
        INSERT INTO bom_items (subsystem_id, row_num, level_str, level_num, parent_material_no, seq_num, material_no, drawing_no, qty, unit, notes, substitute)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (subsystem_id, c_row, c_lvl_str, c_lvl_num, c_parent,
              c_row, c_mat_no, c_dwg, c_qty, c_unit, c_notes, c_sub))

    renumber_subsystem(cursor, subsystem_id)
    conn.commit()
    conn.close()

    msg = f"物料行已添加{'，新物料已自动录入数据库主库' if is_new else ''}"
    if len(children_to_import) > 0:
        msg = f"已成功添加总成 [{material_no}]，并自动整组导入其下属全部 {len(children_to_import)} 个子层级零部件！"

    return jsonify({
        'success': True,
        'is_new_material': is_new,
        'material_no': material_no,
        'imported_children_count': len(children_to_import),
        'message': msg
    })


@bom_bp.route('/api/bom/batch_add', methods=['POST'])
def batch_add_bom_items():
    data = request.get_json(silent=True) or {}
    subsystem_id = data.get('subsystem_id')
    items = data.get('items', [])
    if not subsystem_id:
        return jsonify({'success': False, 'error': '缺少子系统ID'}), 400
    if not items:
        return jsonify({'success': False, 'error': '导入物料列表为空'}), 400

    is_ok, err_msg = check_project_unlocked(subsystem_id=subsystem_id)
    if not is_ok:
        return jsonify({'success': False, 'error': err_msg}), 403

    level_str = data.get('level_str', '••')
    level_num = int(data.get('level_num', 2))
    insert_after_row = data.get('insert_after_row')
    default_qty = str(data.get('default_qty', '1')).strip() or '1'
    default_unit = str(data.get('default_unit', 'PC')).strip() or 'PC'

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT id FROM subsystems WHERE id = ?', (subsystem_id,))
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': '指定的子系统不存在'}), 404

        valid_items = []
        for it in items:
            mat_no = (it.get('material_no') or '').strip()
            if mat_no:
                valid_items.append({
                    'material_no': mat_no,
                    'qty': str(it.get('qty') or default_qty).strip() or '1',
                    'unit': str(it.get('unit') or default_unit).strip() or default_unit
                })

        if not valid_items:
            return jsonify({'success': False, 'error': '未解析到有效的物料号'}), 400

        total_rows = len(valid_items)

        if insert_after_row is not None and str(insert_after_row).isdigit():
            target_start_row = int(insert_after_row) + 1
            cursor.execute('''
            UPDATE bom_items SET row_num = row_num + ? 
            WHERE subsystem_id = ? AND row_num >= ?
            ''', (total_rows, subsystem_id, target_start_row))
        else:
            cursor.execute('SELECT COALESCE(MAX(row_num), 0) + 1 FROM bom_items WHERE subsystem_id = ?', (subsystem_id,))
            target_start_row = cursor.fetchone()[0]

        new_materials_count = 0
        for offset, it in enumerate(valid_items):
            c_row = target_start_row + offset
            mat_no = it['material_no']
            qty = it['qty']
            unit = it['unit']

            cursor.execute('''
            SELECT material_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute 
            FROM materials WHERE material_no = ?
            ''', (mat_no,))
            existing_mat = cursor.fetchone()

            if existing_mat:
                mat_drawing = existing_mat['drawing_no'] or '/'
                mat_unit = unit or existing_mat['unit'] or default_unit
                mat_notes = existing_mat['notes'] or ''
                mat_substitute = existing_mat['substitute'] or ''
            else:
                mat_drawing = '/'
                mat_unit = unit or default_unit
                mat_notes = ''
                mat_substitute = ''
                new_materials_count += 1
                upsert_material(cursor, mat_no, name='', description='', spec_model='', manufacturer='', unit=mat_unit, drawing_no=mat_drawing)

            cursor.execute('''
            INSERT INTO bom_items (subsystem_id, row_num, level_str, level_num, parent_material_no, seq_num, material_no, drawing_no, qty, unit, notes, substitute)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (subsystem_id, c_row, level_str, level_num, '',
                  c_row, mat_no, mat_drawing, qty, mat_unit, mat_notes, mat_substitute))

        renumber_subsystem(cursor, subsystem_id)
        conn.commit()

        msg = f"已成功批量导入 {len(valid_items)} 项物料！"
        if new_materials_count > 0:
            msg += f"（其中 {new_materials_count} 项新物料已自动同步至主库）"

        return jsonify({
            'success': True,
            'imported_count': len(valid_items),
            'new_materials_count': new_materials_count,
            'message': msg
        })
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': f'批量导入失败: {str(e)}'}), 500
    finally:
        try:
            conn.close()
        except Exception:
            pass


@bom_bp.route('/api/bom/update', methods=['POST'])
def update_bom_item():
    data = request.json
    item_id = data.get('id')
    material_no = data.get('material_no', '').strip()
    if not item_id or not material_no:
        return jsonify({'error': '缺少行ID或物料号'}), 400

    is_ok, err_msg = check_project_unlocked(bom_item_id=item_id)
    if not is_ok:
        return jsonify({'error': err_msg}), 403

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT material_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute FROM materials WHERE material_no = ?', (material_no,))
    existing_mat = cursor.fetchone()
    is_new = (existing_mat is None or (not existing_mat['name'] and not existing_mat['description']))

    name = (data.get('name') or data.get('m_name') or '').strip()
    description = (data.get('description') or data.get('m_desc') or '').strip()
    spec_model = (data.get('spec_model') or data.get('m_model') or '').strip()
    manufacturer = (data.get('manufacturer') or data.get('m_mfr') or '').strip()
    unit = (data.get('unit') or data.get('m_unit') or 'PC').strip()
    notes = (data.get('notes') or '').strip()
    substitute = (data.get('substitute') or '').strip()
    remove_image = bool(data.get('remove_image'))
    remove_manual = bool(data.get('remove_manual'))

    drawing_no = (data.get('drawing_no') or '').strip()
    if (not drawing_no or drawing_no == '/') and existing_mat and existing_mat['drawing_no'] and existing_mat['drawing_no'] != '/':
        drawing_no = existing_mat['drawing_no']
    if not drawing_no:
        drawing_no = '/'

    upsert_material(cursor, material_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute, remove_image=remove_image, remove_manual=remove_manual)

    cursor.execute('''
    UPDATE bom_items SET
        level_str=?, level_num=?, material_no=?, drawing_no=?, qty=?, unit=?, notes=?, substitute=?
    WHERE id=?
    ''', (data.get('level_str', '••'), int(data.get('level_num', 2)),
          material_no, drawing_no,
          str(data.get('qty', '1')), unit,
          notes, substitute,
          item_id))

    cursor.execute('SELECT subsystem_id FROM bom_items WHERE id = ?', (item_id,))
    sub_row = cursor.fetchone()
    if sub_row:
        renumber_subsystem(cursor, sub_row[0])

    conn.commit()
    conn.close()
    return jsonify({
        'success': True,
        'is_new_material': is_new,
        'material_no': material_no,
        'message': f"保存成功{'，新物料已自动录入数据库主库' if is_new else ''}"
    })


@bom_bp.route('/api/bom/delete', methods=['POST'])
def delete_bom_item():
    data = request.json or {}
    item_id = data.get('id')
    item_ids = data.get('ids')
    if not item_id and not item_ids:
        return jsonify({'error': '缺少行ID'}), 400

    if not item_ids:
        item_ids = [item_id]

    clean_ids = []
    for x in item_ids:
        try:
            clean_ids.append(int(x))
        except (ValueError, TypeError):
            pass

    if not clean_ids:
        return jsonify({'error': '无效的行ID'}), 400

    is_ok, err_msg = check_project_unlocked(bom_item_id=clean_ids[0])
    if not is_ok:
        return jsonify({'error': err_msg}), 403

    conn = get_db()
    cursor = conn.cursor()
    placeholders = ','.join('?' for _ in clean_ids)
    cursor.execute(f'SELECT DISTINCT subsystem_id FROM bom_items WHERE id IN ({placeholders})', tuple(clean_ids))
    subsystems = [r[0] for r in cursor.fetchall() if r[0]]

    cursor.execute(f'DELETE FROM bom_items WHERE id IN ({placeholders})', tuple(clean_ids))
    for sub_id in subsystems:
        renumber_subsystem(cursor, sub_id)
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'count': len(clean_ids)})


@bom_bp.route('/api/bom/move', methods=['POST'])
def move_bom_item():
    data = request.json
    item_id = data.get('id')
    direction = data.get('direction')
    if not item_id or direction not in ['up', 'down']:
        return jsonify({'error': '无效的参数'}), 400

    is_ok, err_msg = check_project_unlocked(bom_item_id=item_id)
    if not is_ok:
        return jsonify({'error': err_msg}), 403

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT subsystem_id, level_num, row_num FROM bom_items WHERE id = ?', (item_id,))
    item = cursor.fetchone()
    if not item:
        conn.close()
        return jsonify({'error': 'Item not found'}), 404

    subsystem_id = item['subsystem_id']

    # Load all items for this subsystem in current order
    cursor.execute('SELECT id, level_num, row_num FROM bom_items WHERE subsystem_id = ? ORDER BY row_num, id', (subsystem_id,))
    items = [dict(r) for r in cursor.fetchall()]

    idx = next((i for i, it in enumerate(items) if it['id'] == item_id), None)
    if idx is None:
        conn.close()
        return jsonify({'error': 'Item not found in subsystem'}), 404

    L = items[idx]['level_num'] or 2
    start_idx, end_idx = get_subtree_block_indices(items, idx)
    curr_block = items[start_idx:end_idx]

    new_items = items
    if direction == 'up':
        if start_idx > 0:
            prev_idx = start_idx - 1
            if not (L > 1 and (items[prev_idx]['level_num'] or 2) < L):
                while prev_idx >= 0 and (items[prev_idx]['level_num'] or 2) > L:
                    prev_idx -= 1
                if prev_idx >= 0 and (items[prev_idx]['level_num'] or 2) == L:
                    prev_start = prev_idx
                    prev_block = items[prev_start:start_idx]
                    new_items = items[:prev_start] + curr_block + prev_block + items[end_idx:]
                elif L == 1 and start_idx > 0:
                    prev_start = 0
                    prev_block = items[prev_start:start_idx]
                    new_items = items[:prev_start] + curr_block + prev_block + items[end_idx:]

    elif direction == 'down':
        if end_idx < len(items):
            next_start = end_idx
            if (items[next_start]['level_num'] or 2) >= L or L == 1:
                _, next_end = get_subtree_block_indices(items, next_start)
                next_block = items[next_start:next_end]
                new_items = items[:start_idx] + next_block + curr_block + items[next_end:]

    for num, it in enumerate(new_items, 1):
        cursor.execute('UPDATE bom_items SET row_num = ? WHERE id = ?', (num, it['id']))
    renumber_subsystem(cursor, subsystem_id)

    conn.commit()
    conn.close()
    return jsonify({'success': True})


@bom_bp.route('/api/bom/reorder', methods=['POST'])
def reorder_bom_items():
    data = request.json
    subsystem_id = data.get('subsystem_id')
    item_ids = data.get('item_ids', [])
    if not subsystem_id or not item_ids:
        return jsonify({'error': '缺少参数'}), 400

    is_ok, err_msg = check_project_unlocked(subsystem_id=subsystem_id)
    if not is_ok:
        return jsonify({'error': err_msg}), 403

    conn = get_db()
    cursor = conn.cursor()
    for idx, item_id in enumerate(item_ids):
        num = idx + 1
        cursor.execute('UPDATE bom_items SET row_num = ? WHERE id = ? AND subsystem_id = ?',
                       (num, item_id, subsystem_id))
    renumber_subsystem(cursor, subsystem_id)
    conn.commit()
    conn.close()
    return jsonify({'success': True})
