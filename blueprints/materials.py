# blueprints/materials.py
"""
Global Master Materials Library Management, Structures, Auditing & Excel Batch Importer.
"""

import os
import io
import time
import json
from flask import Blueprint, request, jsonify, send_file
from werkzeug.utils import secure_filename
from services.database import get_db, get_material_tree
from services.backup_manager import create_backup_snapshot
from services.data_audit import get_duplicate_materials_report, check_single_material_duplicate
from services.master_importer import analyze_master_excel, execute_master_import
from blueprints.common import UPLOAD_DIR

materials_bp = Blueprint('materials', __name__)


# ----------------- Materials Master Query & Stats -----------------
@materials_bp.route('/api/materials', methods=['GET'])
def get_materials():
    search = request.args.get('q', '').strip()
    filter_type = request.args.get('filter_type', 'all').strip()
    conn = get_db()
    cursor = conn.cursor()

    sql = '''
    SELECT m.*,
           (SELECT COUNT(*) FROM material_structures s WHERE s.parent_material_no = m.material_no) as child_count,
           (SELECT COUNT(DISTINCT p.id)
            FROM bom_items b
            JOIN subsystems sub ON b.subsystem_id = sub.id
            JOIN projects p ON sub.project_id = p.id
            WHERE b.material_no = m.material_no) as usage_project_count,
           (SELECT COUNT(*)
            FROM bom_items b
            WHERE b.material_no = m.material_no) as usage_total_count,
           (SELECT json_group_array(json_object('id', p.id, 'name', COALESCE(NULLIF(p.system_name, ''), NULLIF(p.code, ''), p.name), 'code', p.code))
            FROM (SELECT DISTINCT p.id, p.name, p.system_name, p.code
                  FROM bom_items b
                  JOIN subsystems sub ON b.subsystem_id = sub.id
                  JOIN projects p ON sub.project_id = p.id
                  WHERE b.material_no = m.material_no
                  ORDER BY COALESCE(NULLIF(p.system_name, ''), p.code)) p) as projects_json
    FROM materials m
    WHERE 1=1
    '''
    params = []

    if search:
        query = f"%{search}%"
        sql += """ AND (
            m.material_no LIKE ? OR m.name LIKE ? OR m.description LIKE ?
            OR m.spec_model LIKE ? OR m.manufacturer LIKE ? OR m.drawing_no LIKE ? OR m.notes LIKE ?
            OR EXISTS (
                SELECT 1 FROM bom_items b
                JOIN subsystems sub ON b.subsystem_id = sub.id
                JOIN projects p ON sub.project_id = p.id
                WHERE b.material_no = m.material_no AND (p.name LIKE ? OR p.code LIKE ? OR p.system_name LIKE ?)
            )
        )"""
        params.extend([query, query, query, query, query, query, query, query, query, query])

    if filter_type == 'has_children':
        sql += " AND (SELECT COUNT(*) FROM material_structures s WHERE s.parent_material_no = m.material_no) > 0"
    elif filter_type == 'has_image':
        sql += " AND m.image_path IS NOT NULL AND m.image_path != ''"
    elif filter_type == 'has_manual':
        sql += " AND m.manual_path IS NOT NULL AND m.manual_path != ''"
    elif filter_type == 'referenced':
        sql += " AND (SELECT COUNT(*) FROM bom_items b WHERE b.material_no = m.material_no) > 0"
    elif filter_type == 'unreferenced':
        sql += " AND (SELECT COUNT(*) FROM bom_items b WHERE b.material_no = m.material_no) = 0"

    sql += " ORDER BY m.material_no"
    cursor.execute(sql, tuple(params))
    raw_materials = cursor.fetchall()
    materials = []
    for row in raw_materials:
        d = dict(row)
        pj = d.get('projects_json')
        if pj:
            try:
                d['referenced_projects'] = json.loads(pj)
            except Exception:
                d['referenced_projects'] = []
        else:
            d['referenced_projects'] = []
        materials.append(d)
    conn.close()
    return jsonify(materials)


@materials_bp.route('/api/materials/stats', methods=['GET'])
def get_materials_stats():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM materials')
    total = cursor.fetchone()[0]
    cursor.execute('SELECT COUNT(DISTINCT parent_material_no) FROM material_structures')
    with_children = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM materials WHERE image_path IS NOT NULL AND image_path != ''")
    with_image = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM materials WHERE manual_path IS NOT NULL AND manual_path != ''")
    with_manual = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(DISTINCT material_no) FROM bom_items WHERE material_no IS NOT NULL AND material_no != ''")
    referenced_count = cursor.fetchone()[0]
    conn.close()
    return jsonify({
        'total': total,
        'total_materials': total,
        'with_children': with_children,
        'assemblies_count': with_children,
        'with_image': with_image,
        'images_count': with_image,
        'with_manual': with_manual,
        'manuals_count': with_manual,
        'referenced_count': referenced_count,
        'unreferenced_count': max(0, total - referenced_count)
    })


@materials_bp.route('/api/material/<material_no>/children', methods=['GET'])
def get_material_children_api(material_no):
    mat_no = material_no.strip()
    conn = get_db()
    cursor = conn.cursor()
    children = get_material_tree(cursor, mat_no)
    conn.close()
    return jsonify({
        'has_children': len(children) > 0,
        'count': len(children),
        'material_no': mat_no,
        'children': children
    })


@materials_bp.route('/api/material/save', methods=['POST'])
def save_material():
    data = request.json or {}
    mat_no = data.get('material_no', '').strip()
    old_mat_no = (data.get('old_material_no') or '').strip()
    if not mat_no:
        return jsonify({'error': '物料号不能为空'}), 400

    name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    spec_model = data.get('spec_model', '').strip()
    manufacturer = data.get('manufacturer', '').strip()
    unit = data.get('unit', 'PCS').strip() or 'PCS'
    substitute = data.get('substitute', '').strip()
    drawing_no = data.get('drawing_no', '/').strip() or '/'
    notes = data.get('notes', '').strip()
    is_create = data.get('is_create', False)
    sync_bom = data.get('sync_bom', False)
    remove_image = bool(data.get('remove_image'))
    remove_manual = bool(data.get('remove_manual'))

    conn = get_db()
    cursor = conn.cursor()

    if is_create:
        cursor.execute('SELECT COUNT(*) FROM materials WHERE material_no = ?', (mat_no,))
        if cursor.fetchone()[0] > 0:
            conn.close()
            return jsonify({'error': f'物料号 [{mat_no}] 已存在于主库中，请勿重复创建！'}), 400

        cursor.execute('''
        INSERT INTO materials (material_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute, image_path, manual_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (mat_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute,
              data.get('image_path', '').strip(), data.get('manual_path', '').strip()))
    else:
        target_old = old_mat_no if old_mat_no else mat_no
        if target_old != mat_no:
            cursor.execute('SELECT COUNT(*) FROM materials WHERE material_no = ?', (mat_no,))
            if cursor.fetchone()[0] > 0:
                conn.close()
                return jsonify({'error': f'新物料号 [{mat_no}] 已存在，无法将当前物料修改为此编号！'}), 400

            cursor.execute('''
            UPDATE materials
            SET material_no = ?, name = ?, description = ?, spec_model = ?, manufacturer = ?, unit = ?, drawing_no = ?, notes = ?, substitute = ?
            WHERE material_no = ?
            ''', (mat_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute, target_old))

            cursor.execute('UPDATE material_structures SET parent_material_no = ? WHERE parent_material_no = ?', (mat_no, target_old))
            cursor.execute('UPDATE material_structures SET child_material_no = ? WHERE child_material_no = ?', (mat_no, target_old))
            cursor.execute('UPDATE bom_items SET material_no = ? WHERE material_no = ?', (mat_no, target_old))
            cursor.execute('UPDATE bom_items SET parent_material_no = ? WHERE parent_material_no = ?', (mat_no, target_old))
        else:
            cursor.execute('''
            INSERT INTO materials (material_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute, image_path, manual_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(material_no) DO UPDATE SET
                name=excluded.name,
                description=excluded.description,
                spec_model=excluded.spec_model,
                manufacturer=excluded.manufacturer,
                unit=excluded.unit,
                drawing_no=excluded.drawing_no,
                notes=excluded.notes,
                substitute=excluded.substitute,
                image_path=CASE WHEN excluded.image_path != '' THEN excluded.image_path ELSE materials.image_path END,
                manual_path=CASE WHEN excluded.manual_path != '' THEN excluded.manual_path ELSE materials.manual_path END
            ''', (mat_no, name, description, spec_model, manufacturer, unit, drawing_no, notes, substitute,
                  data.get('image_path', '').strip(), data.get('manual_path', '').strip()))

    if remove_image:
        cursor.execute("UPDATE materials SET image_path = '' WHERE material_no = ?", (mat_no,))
    if remove_manual:
        cursor.execute("UPDATE materials SET manual_path = '' WHERE material_no = ?", (mat_no,))

    synced_rows_count = 0
    if sync_bom:
        cursor.execute('''
        UPDATE bom_items
        SET unit = ?, notes = ?, substitute = ?, drawing_no = CASE WHEN ? != '/' THEN ? ELSE drawing_no END
        WHERE material_no = ?
        ''', (unit, notes, substitute, drawing_no, drawing_no, mat_no))
        synced_rows_count = cursor.rowcount

    conn.commit()
    conn.close()
    return jsonify({'success': True, 'material_no': mat_no, 'synced_rows_count': synced_rows_count})


@materials_bp.route('/api/material/delete', methods=['POST'])
def delete_material():
    data = request.json or {}
    mat_no = data.get('material_no', '').strip()
    if not mat_no:
        return jsonify({'error': '未提供物料号'}), 400

    try:
        create_backup_snapshot(reason='delete_material', note=f'删除通用物料 [{mat_no}] 前自动备份')
    except Exception as e_snap:
        print("Auto-backup before delete material warning:", e_snap)

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM material_structures WHERE parent_material_no = ? OR child_material_no = ?', (mat_no, mat_no))
    cursor.execute('DELETE FROM materials WHERE material_no = ?', (mat_no,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': f'物料 [{mat_no}] 已成功从全局通用物料主库中移除！'})


@materials_bp.route('/api/materials/clear', methods=['POST'])
def clear_materials():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM materials')
    mat_count = cursor.fetchone()[0]
    cursor.execute('SELECT COUNT(*) FROM material_structures')
    struct_count = cursor.fetchone()[0]

    try:
        create_backup_snapshot(reason='clear_master', note=f'清空全局物料主库前自动备份（原含 {mat_count} 个物料）')
    except Exception as e_snap:
        print("Auto-backup before clear materials warning:", e_snap)

    cursor.execute('DELETE FROM material_structures')
    cursor.execute('DELETE FROM materials')
    conn.commit()
    conn.close()
    return jsonify({
        'success': True,
        'deleted_materials_count': mat_count,
        'deleted_structures_count': struct_count,
        'message': f'全局通用物料主库已成功清空（共清除 {mat_count} 项物料，{struct_count} 项总成层级关系）！'
    })


@materials_bp.route('/api/material/<path:material_no>/usage', methods=['GET'])
def get_material_usage(material_no):
    mat_no = material_no.strip()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    SELECT b.id, b.row_num, b.seq_num, b.qty, b.unit, b.level_num, b.level_str,
           s.id as subsystem_id, s.name as subsystem_name,
           p.id as project_id,
           COALESCE(NULLIF(p.system_name, ''), NULLIF(p.code, ''), p.name) as project_name,
           p.code as project_code,
           p.name as product_name
    FROM bom_items b
    JOIN subsystems s ON b.subsystem_id = s.id
    JOIN projects p ON s.project_id = p.id
    WHERE b.material_no = ?
    ORDER BY COALESCE(NULLIF(p.system_name, ''), p.name), s.name, b.row_num
    ''', (mat_no,))
    usage_list = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify({
        'material_no': mat_no,
        'count': len(usage_list),
        'usage': usage_list,
        'usages': usage_list
    })


@materials_bp.route('/api/material/<path:material_no>/structure', methods=['GET'])
def get_material_structure(material_no):
    mat_no = material_no.strip()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    SELECT s.id, s.parent_material_no, s.child_material_no, s.child_level_num,
           s.child_level_str, s.sort_order, s.qty, s.unit, s.drawing_no, s.notes, s.substitute,
           s.child_level_num as level_num,
           COALESCE(m.name, '') as name,
           COALESCE(m.description, '') as description,
           COALESCE(m.spec_model, '') as spec_model,
           COALESCE(m.manufacturer, '') as manufacturer,
           COALESCE(m.name, '') as m_name,
           COALESCE(m.description, '') as m_desc,
           COALESCE(m.spec_model, '') as m_model,
           COALESCE(m.manufacturer, '') as m_mfr,
           m.unit as m_unit, m.image_path, m.manual_path
    FROM material_structures s
    LEFT JOIN materials m ON s.child_material_no = m.material_no
    WHERE s.parent_material_no = ?
    ORDER BY s.sort_order, s.id
    ''', (mat_no,))
    children = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify({
        'parent_material_no': mat_no,
        'count': len(children),
        'children': children
    })


@materials_bp.route('/api/material/structure/save', methods=['POST'])
def save_material_structure():
    data = request.json or {}
    struct_id = data.get('id')
    parent_mat = data.get('parent_material_no', '').strip()
    child_mat = data.get('child_material_no', '').strip()

    if not parent_mat or not child_mat:
        return jsonify({'error': '父物料号和子物料号均不能为空'}), 400

    if parent_mat.lower() == child_mat.lower():
        return jsonify({'error': '父物料号与子物料号不能相同'}), 400

    conn = get_db()
    cursor = conn.cursor()

    parent_lvl = 1
    cursor.execute('SELECT child_level_num FROM material_structures WHERE child_material_no = ?', (parent_mat,))
    p_struct = cursor.fetchone()
    if p_struct and p_struct[0]:
        parent_lvl = int(p_struct[0])
    else:
        cursor.execute('SELECT level_num FROM bom_items WHERE material_no = ? ORDER BY id DESC', (parent_mat,))
        b_row = cursor.fetchone()
        if b_row and b_row[0]:
            parent_lvl = int(b_row[0])

    lvl = parent_lvl + 1
    lvl_str = '•' * lvl
    qty = str(data.get('qty', '1')).strip()
    unit = data.get('unit', 'PCS').strip()
    dwg = data.get('drawing_no', '/').strip()
    notes = data.get('notes', '').strip()
    substitute = data.get('substitute', '').strip()

    cursor.execute('SELECT COUNT(*) FROM materials WHERE material_no = ?', (child_mat,))
    if cursor.fetchone()[0] == 0:
        cursor.execute('''
        INSERT INTO materials (material_no, name, description, spec_model, manufacturer, unit)
        VALUES (?, ?, ?, ?, ?, ?)
        ''', (child_mat, data.get('m_name', '').strip(), data.get('m_desc', '').strip(),
              data.get('m_model', '').strip(), data.get('m_mfr', '').strip(), unit))

    if struct_id:
        cursor.execute('''
        UPDATE material_structures
        SET child_level_num = ?, child_level_str = ?, qty = ?, unit = ?, drawing_no = ?, notes = ?, substitute = ?
        WHERE id = ?
        ''', (lvl, lvl_str, qty, unit, dwg, notes, substitute, struct_id))
    else:
        cursor.execute('SELECT id FROM material_structures WHERE parent_material_no = ? AND child_material_no = ?',
                       (parent_mat, child_mat))
        existing = cursor.fetchone()
        if existing:
            cursor.execute('''
            UPDATE material_structures
            SET child_level_num = ?, child_level_str = ?, qty = ?, unit = ?, drawing_no = ?, notes = ?, substitute = ?
            WHERE id = ?
            ''', (lvl, lvl_str, qty, unit, dwg, notes, substitute, existing[0]))
        else:
            cursor.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM material_structures WHERE parent_material_no = ?', (parent_mat,))
            next_sort = cursor.fetchone()[0]
            cursor.execute('''
            INSERT INTO material_structures (parent_material_no, child_material_no, child_level_num, child_level_str, sort_order, qty, unit, drawing_no, notes, substitute)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (parent_mat, child_mat, lvl, lvl_str, next_sort, qty, unit, dwg, notes, substitute))

    conn.commit()
    conn.close()
    return jsonify({'success': True})


@materials_bp.route('/api/material/structure/delete', methods=['POST'])
def delete_material_structure():
    data = request.json or {}
    struct_id = data.get('id')
    if not struct_id:
        return jsonify({'error': '未提供结构ID'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM material_structures WHERE id = ?', (struct_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@materials_bp.route('/api/material/structure/clear', methods=['POST'])
def clear_material_structures():
    data = request.json or {}
    parent_mat = data.get('parent_material_no', '').strip()
    if not parent_mat:
        return jsonify({'error': '未提供父物料号'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM material_structures WHERE parent_material_no = ?', (parent_mat,))
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()
    return jsonify({
        'success': True,
        'deleted_count': deleted_count,
        'message': f"已成功清空总成 [{parent_mat}] 的全部下属子零部件（共 {deleted_count} 项）"
    })


@materials_bp.route('/api/material/structure/move', methods=['POST'])
def move_material_structure():
    data = request.json or {}
    struct_id = data.get('id')
    direction = data.get('direction', 'up')
    if not struct_id:
        return jsonify({'error': '未提供结构ID'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, parent_material_no, sort_order FROM material_structures WHERE id = ?', (struct_id,))
    curr = cursor.fetchone()
    if not curr:
        conn.close()
        return jsonify({'error': '结构记录未找到'}), 404

    parent_mat = curr['parent_material_no']
    curr_order = curr['sort_order']

    cursor.execute('SELECT id, sort_order FROM material_structures WHERE parent_material_no = ? ORDER BY sort_order, id', (parent_mat,))
    all_children = cursor.fetchall()
    all_ids = [r['id'] for r in all_children]
    idx = all_ids.index(struct_id)

    if direction == 'up' and idx > 0:
        other_id = all_ids[idx - 1]
    elif direction == 'down' and idx < len(all_ids) - 1:
        other_id = all_ids[idx + 1]
    else:
        conn.close()
        return jsonify({'success': True})

    cursor.execute('SELECT sort_order FROM material_structures WHERE id = ?', (other_id,))
    other_order = cursor.fetchone()['sort_order']

    cursor.execute('UPDATE material_structures SET sort_order = ? WHERE id = ?', (other_order, struct_id))
    cursor.execute('UPDATE material_structures SET sort_order = ? WHERE id = ?', (curr_order, other_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@materials_bp.route('/api/material/asset/delete', methods=['POST'])
def delete_material_asset():
    data = request.json or {}
    mat_no = data.get('material_no', '').strip()
    asset_type = data.get('asset_type', '').strip()
    if not mat_no or not asset_type:
        return jsonify({'error': '参数不全'}), 400

    conn = get_db()
    cursor = conn.cursor()
    if asset_type == 'image':
        cursor.execute("UPDATE materials SET image_path = '' WHERE material_no = ?", (mat_no,))
    elif asset_type == 'manual':
        cursor.execute("UPDATE materials SET manual_path = '' WHERE material_no = ?", (mat_no,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@materials_bp.route('/api/materials/export', methods=['GET'])
def export_materials_excel():
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    SELECT m.*,
           (SELECT COUNT(*) FROM material_structures s WHERE s.parent_material_no = m.material_no) as child_count,
           (SELECT GROUP_CONCAT(DISTINCT COALESCE(NULLIF(p.system_name, ''), NULLIF(p.code, ''), p.name))
            FROM bom_items b
            JOIN subsystems sub ON b.subsystem_id = sub.id
            JOIN projects p ON sub.project_id = p.id
            WHERE b.material_no = m.material_no) as referenced_projects
    FROM materials m
    ORDER BY m.material_no
    ''')
    rows = cursor.fetchall()
    conn.close()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "全局通用物料主库"

    headers = [
        "物料号", "元器件名称", "引用项目", "物料完整描述", "规格型号", "制造商",
        "单位", "图纸/代号", "子层级数", "实物图片", "技术手册(PDF)", "替代物料", "补充说明"
    ]
    ws.append(headers)

    header_font = Font(name="微软雅黑", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left_align = Alignment(horizontal="left", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style='thin', color='D9D9D9'),
        right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'),
        bottom=Side(style='thin', color='D9D9D9')
    )

    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
    ws.row_dimensions[1].height = 28

    data_font = Font(name="微软雅黑", size=10)
    for r_idx, r in enumerate(rows, start=2):
        row_values = [
            r['material_no'],
            r['name'] or '',
            r['referenced_projects'] or '未引用',
            r['description'] or '',
            r['spec_model'] or '',
            r['manufacturer'] or '',
            r['unit'] or 'PCS',
            r['drawing_no'] or '/',
            r['child_count'] if r['child_count'] > 0 else 0,
            "已配备" if r['image_path'] else "无",
            "已配备" if r['manual_path'] else "无",
            r['substitute'] or '',
            r['notes'] or ''
        ]
        ws.append(row_values)
        for c_idx in range(1, len(row_values) + 1):
            c = ws.cell(row=r_idx, column=c_idx)
            c.font = data_font
            c.border = thin_border
            if c_idx in [1, 7, 8, 9, 10, 11]:
                c.alignment = center_align
            else:
                c.alignment = left_align
        ws.row_dimensions[r_idx].height = 22

    col_widths = {
        1: 18, 2: 22, 3: 24, 4: 38, 5: 25, 6: 18,
        7: 8, 8: 16, 9: 12, 10: 12, 11: 14,
        12: 16, 13: 24
    }
    for col_idx, width in col_widths.items():
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return send_file(
        buffer,
        as_attachment=True,
        download_name="全局通用物料主库清单.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


# ----------------- Master Materials Excel Import API -----------------
@materials_bp.route('/api/materials/import/analyze', methods=['POST'])
def analyze_master_import():
    if 'file' not in request.files:
        return jsonify({'error': '未选择要上传的 Excel 文件'}), 400
    file = request.files['file']
    if not file.filename.lower().endswith('.xlsx'):
        return jsonify({'error': '请上传 .xlsx 格式的 Excel 文件'}), 400

    filename = secure_filename(file.filename) or 'master_import.xlsx'
    temp_filename = f"temp_master_{int(time.time())}_{filename}"
    save_path = os.path.join(UPLOAD_DIR, temp_filename)
    file.save(save_path)

    try:
        res = analyze_master_excel(save_path)
        res['temp_filename'] = temp_filename
        res['original_filename'] = file.filename
        return jsonify(res)
    except Exception as e:
        return jsonify({'error': f'解析 Excel 文件失败: {str(e)}'}), 500


@materials_bp.route('/api/materials/import/reanalyze', methods=['POST'])
def reanalyze_master_import():
    data = request.json or {}
    temp_filename = data.get('temp_filename', '').strip()
    sheet_name = data.get('sheet_name', '').strip()
    if not temp_filename:
        return jsonify({'error': '缺少临时文件名'}), 400

    save_path = os.path.join(UPLOAD_DIR, temp_filename)
    if not os.path.exists(save_path):
        return jsonify({'error': '上传的临时文件已过期，请重新选择文件上传'}), 400

    try:
        res = analyze_master_excel(save_path, sheet_name)
        res['temp_filename'] = temp_filename
        return jsonify(res)
    except Exception as e:
        return jsonify({'error': f'切换工作表分析失败: {str(e)}'}), 500


@materials_bp.route('/api/materials/import/execute', methods=['POST'])
def execute_master_import_api():
    data = request.json or {}
    temp_filename = data.get('temp_filename', '').strip()
    sheet_name = data.get('sheet_name', '').strip()
    header_row = data.get('header_row', 1)
    mapping = data.get('mapping', {})
    overwrite = data.get('overwrite', True)

    if not temp_filename:
        return jsonify({'error': '缺少临时文件名'}), 400

    save_path = os.path.join(UPLOAD_DIR, temp_filename)
    if not os.path.exists(save_path):
        return jsonify({'error': '上传的临时文件已过期，请重新选择文件上传'}), 400

    try:
        create_backup_snapshot(reason='import_master_excel', note=f'批量导入主库物料Excel [{temp_filename}] 前自动备份')
    except Exception as e_snap:
        print("Auto-backup before master import warning:", e_snap)

    try:
        res = execute_master_import(save_path, sheet_name=sheet_name, header_row=header_row, mapping=mapping, overwrite=overwrite)
        if isinstance(res, dict) and 'error' in res:
            return jsonify(res), 400
        return jsonify(res)
    except Exception as e:
        return jsonify({'error': f'导入物料失败: {str(e)}'}), 500


@materials_bp.route('/api/material/<path:material_no>', methods=['GET'])
def get_single_material(material_no):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    SELECT m.*,
           (SELECT COUNT(*) FROM material_structures s WHERE s.parent_material_no = m.material_no) as child_count,
           (SELECT COUNT(*) FROM bom_items b WHERE b.material_no = m.material_no) as usage_count
    FROM materials m
    WHERE m.material_no = ?
    ''', (material_no.strip(),))
    row = cursor.fetchone()
    conn.close()
    if row:
        return jsonify(dict(row))
    return jsonify(None), 404


# ----------------- Material Master Data Audit & De-duplication APIs -----------------
@materials_bp.route('/api/materials/audit', methods=['GET'])
def api_materials_audit():
    try:
        report = get_duplicate_materials_report()
        return jsonify({'success': True, 'report': report})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@materials_bp.route('/api/materials/check_duplicate', methods=['GET'])
def api_check_duplicate():
    name = request.args.get('name', '')
    spec_model = request.args.get('spec_model', '')
    mat_no = request.args.get('mat_no', '')
    try:
        matches = check_single_material_duplicate(name, spec_model, exclude_mat_no=mat_no)
        return jsonify({'success': True, 'matches': matches})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
