import os
import io
import json
import zipfile
import shutil
from datetime import datetime
from .database import get_db

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
IMAGES_DIR = os.path.join(ASSETS_DIR, 'images')
MANUALS_DIR = os.path.join(ASSETS_DIR, 'manuals')
os.makedirs(IMAGES_DIR, exist_ok=True)
os.makedirs(MANUALS_DIR, exist_ok=True)

def export_project_data(project_id):
    """
    Extracts all metadata, subsystems, BOM items, signatures, ECN records,
    referenced materials, and material structures for a given project.
    """
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    proj_row = cursor.fetchone()
    if not proj_row:
        conn.close()
        return None

    project_info = dict(proj_row)

    # Signatures
    cursor.execute('SELECT role, sign_name, sign_date FROM signatures WHERE project_id = ?', (project_id,))
    signatures = [dict(r) for r in cursor.fetchall()]

    # ECN records
    cursor.execute('SELECT ecn_no, change_desc, changer, change_date FROM ecn_records WHERE project_id = ? ORDER BY id', (project_id,))
    ecn_records = [dict(r) for r in cursor.fetchall()]

    # Subsystems
    cursor.execute('SELECT id, name, system_title, doc_no, sort_order FROM subsystems WHERE project_id = ? ORDER BY sort_order, id', (project_id,))
    sub_rows = cursor.fetchall()

    subsystems = []
    used_material_nos = set()

    for s in sub_rows:
        sub_id = s['id']
        cursor.execute('''
        SELECT b.id, b.row_num, b.level_str, b.level_num, b.seq_num, b.material_no,
               b.parent_material_no, b.drawing_no, b.qty, b.unit, b.notes, b.substitute,
               m.name as m_name, m.description as m_desc, m.spec_model as m_model,
               m.manufacturer as m_mfr, m.unit as m_unit, m.image_path, m.manual_path,
               m.substitute as m_substitute
        FROM bom_items b
        LEFT JOIN materials m ON b.material_no = m.material_no
        WHERE b.subsystem_id = ?
        ORDER BY b.row_num, b.id
        ''', (sub_id,))
        items = [dict(r) for r in cursor.fetchall()]
        for it in items:
            if it.get('material_no'):
                used_material_nos.add(it['material_no'])
            if it.get('parent_material_no'):
                used_material_nos.add(it['parent_material_no'])

        subsystems.append({
            'name': s['name'],
            'system_title': s['system_title'] or '',
            'doc_no': s['doc_no'] or '',
            'sort_order': s['sort_order'] or 0,
            'items': items
        })

    # Materials master data
    materials_list = []
    if used_material_nos:
        placeholders = ','.join(['?'] * len(used_material_nos))
        cursor.execute(f'''
        SELECT material_no, name, description, spec_model, manufacturer,
               unit, drawing_no, image_path, manual_path, substitute, notes
        FROM materials
        WHERE material_no IN ({placeholders})
        ''', list(used_material_nos))
        materials_list = [dict(r) for r in cursor.fetchall()]

    # Material hierarchy structures for assemblies
    structures_list = []
    if used_material_nos:
        placeholders = ','.join(['?'] * len(used_material_nos))
        cursor.execute(f'''
        SELECT parent_material_no, child_material_no, child_level_num,
               child_level_str, sort_order, qty, unit, drawing_no, notes, substitute
        FROM material_structures
        WHERE parent_material_no IN ({placeholders}) OR child_material_no IN ({placeholders})
        ''', list(used_material_nos) + list(used_material_nos))
        structures_list = [dict(r) for r in cursor.fetchall()]

    conn.close()

    bundle = {
        'format_version': '1.0',
        'generator': 'Wind Turbine Service BOM System',
        'exported_at': datetime.now().isoformat(),
        'project': {
            'code': project_info.get('code') or '',
            'name': project_info.get('name') or '',
            'system_name': project_info.get('system_name') or '',
            'doc_no': project_info.get('doc_no') or '',
            'ecn_no': project_info.get('ecn_no') or '',
            'form_no': project_info.get('form_no') or 'FDJL-JS-037',
            'company': project_info.get('company') or '上海电气风电集团股份有限公司'
        },
        'signatures': signatures,
        'ecn_records': ecn_records,
        'subsystems': subsystems,
        'materials': materials_list,
        'material_structures': structures_list
    }
    return bundle

def create_project_bundle_file(project_id, bundle_format='sbom'):
    """
    Creates an export file (in-memory BytesIO) for the project.
    - 'sbom' (or 'zip'): ZIP bundle containing project.json and any referenced image/manual assets.
    - 'json': Raw JSON file.
    Returns (BytesIO, download_filename, mimetype)
    """
    bundle_data = export_project_data(project_id)
    if not bundle_data:
        return None, None, None

    proj = bundle_data['project']
    system_name = (proj.get('system_name') or '').strip()
    name = (proj.get('name') or '').strip()
    code = (proj.get('code') or '').strip()

    if system_name and system_name != '风力发电机组':
        raw_name = system_name
    elif name and name != '风力发电机组':
        raw_name = name
    elif system_name:
        raw_name = system_name
    elif code:
        raw_name = code
    else:
        raw_name = 'Service_BOM'

    safe_name = "".join(c for c in raw_name if c not in r'\/:*?"<>|').strip() or "Service_BOM"

    if bundle_format == 'json':
        json_bytes = json.dumps(bundle_data, ensure_ascii=False, indent=2).encode('utf-8')
        buffer = io.BytesIO(json_bytes)
        buffer.seek(0)
        return buffer, f"{safe_name}.json", 'application/json'

    # Default: .sbom (ZIP container)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 1. project.json
        json_str = json.dumps(bundle_data, ensure_ascii=False, indent=2)
        zf.writestr('project.json', json_str.encode('utf-8'))

        # 2. Package assets (images and manuals)
        for mat in bundle_data.get('materials', []):
            img_path = mat.get('image_path')
            if img_path:
                full_img_path = os.path.join(BASE_DIR, img_path.replace('/', os.sep))
                if os.path.exists(full_img_path):
                    rel_arc_path = f"assets/images/{os.path.basename(full_img_path)}"
                    zf.write(full_img_path, arcname=rel_arc_path)

            manual_path = mat.get('manual_path')
            if manual_path:
                full_manual_path = os.path.join(BASE_DIR, manual_path.replace('/', os.sep))
                if os.path.exists(full_manual_path):
                    rel_arc_path = f"assets/manuals/{os.path.basename(full_manual_path)}"
                    zf.write(full_manual_path, arcname=rel_arc_path)

    buffer.seek(0)
    filename = f"{safe_name}.sbom"
    return buffer, filename, 'application/octet-stream'

def parse_project_bundle_from_file(file_path):
    """
    Parses a saved project file (either .sbom / .zip or .json).
    Returns (bundle_data, is_archive, zip_obj_or_none)
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError("文件不存在")

    # Try ZIP archive first (.sbom / .zip)
    if zipfile.is_zipfile(file_path):
        zf = zipfile.ZipFile(file_path, 'r')
        if 'project.json' not in zf.namelist():
            # Search for any json file inside
            json_names = [n for n in zf.namelist() if n.endswith('.json')]
            if not json_names:
                raise ValueError("工程包内未找到有效的 project.json 文件")
            json_entry = json_names[0]
        else:
            json_entry = 'project.json'

        with zf.open(json_entry) as jf:
            bundle_data = json.load(jf)
        return bundle_data, True, zf

    # Otherwise try plain JSON
    with open(file_path, 'r', encoding='utf-8') as f:
        bundle_data = json.load(f)
    return bundle_data, False, None

def inspect_saved_project_file(file_path):
    """
    Inspects an uploaded project file and returns its summary and conflict status.
    """
    bundle_data, is_archive, zf = parse_project_bundle_from_file(file_path)
    if zf:
        zf.close()

    proj = bundle_data.get('project', {})
    name = (proj.get('name') or '').strip()
    code = (proj.get('code') or '').strip()
    system_name = (proj.get('system_name') or '').strip()

    if not name and not code:
        raise ValueError("无效的项目文件：缺少项目名称或代号")

    subsystems = bundle_data.get('subsystems', [])
    total_items = sum(len(s.get('items', [])) for s in subsystems)
    materials = bundle_data.get('materials', [])
    signatures = bundle_data.get('signatures', [])
    ecn_records = bundle_data.get('ecn_records', [])

    # Check for existing project in database
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, code, system_name FROM projects WHERE code = ? OR name = ?', (code, name))
    existing = cursor.fetchone()
    conn.close()

    existing_dict = None
    if existing:
        existing_dict = {
            'id': existing['id'],
            'name': existing['name'],
            'code': existing['code'],
            'system_name': existing['system_name']
        }

    return {
        'success': True,
        'name': name,
        'code': code,
        'system_name': system_name,
        'doc_no': proj.get('doc_no', ''),
        'company': proj.get('company', ''),
        'subsystems_count': len(subsystems),
        'subsystems_names': [s.get('name') for s in subsystems],
        'total_items_count': total_items,
        'materials_count': len(materials),
        'signatures_count': len(signatures),
        'ecn_count': len(ecn_records),
        'exported_at': bundle_data.get('exported_at', ''),
        'format_version': bundle_data.get('format_version', '1.0'),
        'has_conflict': (existing_dict is not None),
        'existing_project': existing_dict
    }

def import_project_from_file(file_path, action='new', target_project_id=None):
    """
    Imports and restores a project into the database.
    - action: 'new' (creates as new project, resolving any name/code conflict)
              'overwrite' (overwrites existing project data under target_project_id)
    """
    bundle_data, is_archive, zf = parse_project_bundle_from_file(file_path)

    try:
        # Extract embedded assets if archive
        if is_archive and zf:
            for item in zf.namelist():
                if item.startswith('assets/images/') and not item.endswith('/'):
                    fname = os.path.basename(item)
                    if fname:
                        target = os.path.join(IMAGES_DIR, fname)
                        with zf.open(item) as src, open(target, 'wb') as dst:
                            shutil.copyfileobj(src, dst)
                elif item.startswith('assets/manuals/') and not item.endswith('/'):
                    fname = os.path.basename(item)
                    if fname:
                        target = os.path.join(MANUALS_DIR, fname)
                        with zf.open(item) as src, open(target, 'wb') as dst:
                            shutil.copyfileobj(src, dst)
    finally:
        if zf:
            zf.close()

    proj = bundle_data.get('project', {})
    name = (proj.get('name') or proj.get('code') or '已打开项目').strip()
    code = (proj.get('code') or name).strip()
    system_name = (proj.get('system_name') or name).strip()
    doc_no = proj.get('doc_no', '')
    ecn_no = proj.get('ecn_no', '')
    form_no = proj.get('form_no', 'FDJL-JS-037')
    company = proj.get('company', '上海电气风电集团股份有限公司')

    conn = get_db()
    cursor = conn.cursor()

    # 1. Upsert referenced materials into Master Materials Hub
    for mat in bundle_data.get('materials', []):
        mat_no = (mat.get('material_no') or '').strip()
        if not mat_no:
            continue
        cursor.execute('''
        INSERT INTO materials (material_no, name, description, spec_model, manufacturer, unit, drawing_no, image_path, manual_path, substitute, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(material_no) DO UPDATE SET
            name = CASE WHEN excluded.name != '' THEN excluded.name ELSE materials.name END,
            description = CASE WHEN excluded.description != '' THEN excluded.description ELSE materials.description END,
            spec_model = CASE WHEN excluded.spec_model != '' THEN excluded.spec_model ELSE materials.spec_model END,
            manufacturer = CASE WHEN excluded.manufacturer != '' THEN excluded.manufacturer ELSE materials.manufacturer END,
            unit = CASE WHEN excluded.unit != '' THEN excluded.unit ELSE materials.unit END,
            drawing_no = CASE WHEN excluded.drawing_no != '' AND excluded.drawing_no != '/' THEN excluded.drawing_no ELSE materials.drawing_no END,
            image_path = CASE WHEN excluded.image_path != '' THEN excluded.image_path ELSE materials.image_path END,
            manual_path = CASE WHEN excluded.manual_path != '' THEN excluded.manual_path ELSE materials.manual_path END,
            substitute = CASE WHEN excluded.substitute != '' THEN excluded.substitute ELSE materials.substitute END,
            notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE materials.notes END
        ''', (
            mat_no,
            mat.get('name', ''),
            mat.get('description', ''),
            mat.get('spec_model', ''),
            mat.get('manufacturer', ''),
            mat.get('unit', 'PCS'),
            mat.get('drawing_no', '/'),
            mat.get('image_path', ''),
            mat.get('manual_path', ''),
            mat.get('substitute', ''),
            mat.get('notes', '')
        ))

    # 2. Upsert material hierarchy structures
    for st in bundle_data.get('material_structures', []):
        p_mat = st.get('parent_material_no')
        c_mat = st.get('child_material_no')
        if not p_mat or not c_mat:
            continue
        cursor.execute('''
        SELECT id FROM material_structures WHERE parent_material_no = ? AND child_material_no = ?
        ''', (p_mat, c_mat))
        row = cursor.fetchone()
        if not row:
            cursor.execute('''
            INSERT INTO material_structures (parent_material_no, child_material_no, child_level_num, child_level_str, sort_order, qty, unit, drawing_no, notes, substitute)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                p_mat, c_mat,
                st.get('child_level_num', 2),
                st.get('child_level_str', '••'),
                st.get('sort_order', 1),
                st.get('qty', '1'),
                st.get('unit', 'PCS'),
                st.get('drawing_no', '/'),
                st.get('notes', ''),
                st.get('substitute', '')
            ))

    project_id = None

    if action == 'overwrite' and target_project_id:
        project_id = int(target_project_id)
        # Update project info
        cursor.execute('''
        UPDATE projects SET code = ?, name = ?, system_name = ?, doc_no = ?, ecn_no = ?, form_no = ?, company = ?
        WHERE id = ?
        ''', (code, name, system_name, doc_no, ecn_no, form_no, company, project_id))

        # Clear existing project details to be replaced
        cursor.execute('DELETE FROM signatures WHERE project_id = ?', (project_id,))
        cursor.execute('DELETE FROM ecn_records WHERE project_id = ?', (project_id,))
        cursor.execute('SELECT id FROM subsystems WHERE project_id = ?', (project_id,))
        old_sub_ids = [r[0] for r in cursor.fetchall()]
        for s_id in old_sub_ids:
            cursor.execute('DELETE FROM bom_items WHERE subsystem_id = ?', (s_id,))
        cursor.execute('DELETE FROM subsystems WHERE project_id = ?', (project_id,))

    else:
        # Create as new project, resolving code / name conflict
        cursor.execute('SELECT id FROM projects WHERE code = ?', (code,))
        if cursor.fetchone():
            base_code = code
            suffix = 2
            while True:
                candidate = f"{base_code}_{suffix}"
                cursor.execute('SELECT id FROM projects WHERE code = ?', (candidate,))
                if not cursor.fetchone():
                    code = candidate
                    break
                suffix += 1

        cursor.execute('SELECT id FROM projects WHERE name = ?', (name,))
        if cursor.fetchone():
            name = f"{name} (已打开)"

        cursor.execute('''
        INSERT INTO projects (code, name, system_name, doc_no, ecn_no, form_no, company)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (code, name, system_name, doc_no, ecn_no, form_no, company))
        project_id = cursor.lastrowid

    # 3. Insert signatures
    for sig in bundle_data.get('signatures', []):
        cursor.execute('''
        INSERT INTO signatures (project_id, role, sign_name, sign_date)
        VALUES (?, ?, ?, ?)
        ''', (project_id, sig.get('role', ''), sig.get('sign_name', ''), sig.get('sign_date', '')))

    # 4. Insert ECN records
    for ecn in bundle_data.get('ecn_records', []):
        cursor.execute('''
        INSERT INTO ecn_records (project_id, ecn_no, change_desc, changer, change_date)
        VALUES (?, ?, ?, ?, ?)
        ''', (project_id, ecn.get('ecn_no', ''), ecn.get('change_desc', ''), ecn.get('changer', ''), ecn.get('change_date', '')))

    # 5. Insert subsystems and BOM items
    subsystems_data = bundle_data.get('subsystems', [])
    if not subsystems_data:
        # Ensure at least one default subsystem
        subsystems_data = [{'name': 'BOM清单', 'sort_order': 0, 'items': []}]

    first_sub_id = None
    total_imported_items = 0

    for s_idx, sub in enumerate(subsystems_data):
        sub_name = (sub.get('name') or f'Sheet_{s_idx+1}').strip()
        cursor.execute('''
        INSERT INTO subsystems (project_id, name, system_title, doc_no, sort_order)
        VALUES (?, ?, ?, ?, ?)
        ''', (project_id, sub_name, sub.get('system_title', ''), sub.get('doc_no', ''), sub.get('sort_order', s_idx)))
        sub_id = cursor.lastrowid
        if first_sub_id is None:
            first_sub_id = sub_id

        items = sub.get('items', [])
        for it in items:
            mat_no = (it.get('material_no') or '').strip()
            if not mat_no:
                continue
            cursor.execute('''
            INSERT INTO bom_items (subsystem_id, row_num, level_str, level_num, seq_num, material_no,
                                   parent_material_no, drawing_no, qty, unit, notes, substitute)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                sub_id,
                it.get('row_num', 1),
                it.get('level_str', '••'),
                it.get('level_num', 2),
                it.get('seq_num', 1),
                mat_no,
                it.get('parent_material_no'),
                it.get('drawing_no', '/'),
                it.get('qty', '1'),
                it.get('unit', 'PCS'),
                it.get('notes', ''),
                it.get('substitute', '')
            ))
            total_imported_items += 1

    conn.commit()
    conn.close()

    return {
        'success': True,
        'project_id': project_id,
        'first_subsystem_id': first_sub_id,
        'name': name,
        'code': code,
        'total_items': total_imported_items,
        'message': f'项目工程【{name}】已成功打开载入！包含 {len(subsystems_data)} 个子系统 Sheet，共 {total_imported_items} 项物料数据。'
    }
