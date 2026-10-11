import os
import zipfile
import xml.etree.ElementTree as ET
from .database import get_db, init_db, find_template_path
from .config import config

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
IMAGES_DIR = os.path.join(ASSETS_DIR, 'images')
MANUALS_DIR = os.path.join(ASSETS_DIR, 'manuals')

os.makedirs(IMAGES_DIR, exist_ok=True)
os.makedirs(MANUALS_DIR, exist_ok=True)

def import_excel_sbom(excel_path):
    """
    Imports a complete SBOM Excel workbook into the database and extracts media assets.
    """
    init_db()
    conn = get_db()
    cursor = conn.cursor()

    with zipfile.ZipFile(excel_path, 'r') as z:
        # Load shared strings
        sst = []
        if 'xl/sharedStrings.xml' in z.namelist():
            ss_root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for si in ss_root.findall('.//main:si', ns):
                text = ''.join([t.text for t in si.findall('.//main:t', ns) if t.text])
                sst.append(text)

        # Load workbook relationships
        wb_rels = {}
        if 'xl/_rels/workbook.xml.rels' in z.namelist():
            for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels')):
                wb_rels[r.attrib['Id']] = r.attrib['Target']

        # Read sheet list from workbook.xml
        wb_root = ET.fromstring(z.read('xl/workbook.xml'))
        ns_wb = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        r_ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        
        sheet_info = [] # [(name, sheet_xml_path)]
        for s in wb_root.findall('.//main:sheet', ns_wb):
            s_name = s.attrib.get('name')
            r_id = s.attrib.get(f'{{{r_ns}}}id')
            target = wb_rels.get(r_id, '')
            if target:
                sheet_xml_path = 'xl/' + target if not target.startswith('xl/') else target
                sheet_info.append((s_name, sheet_xml_path))

        # 1. Parse 封面 (Cover Sheet)
        project_code = 'EW6.25-220'
        project_name = '风力发电机组'
        system_name = 'EW6.25-220变桨轴承润滑系统SBOM'
        doc_no = ''
        ecn_no = ''
        form_no = config.form_no_default
        company = config.company_default

        cover_sheets = [s for s in sheet_info if '封面' in s[0]]
        if cover_sheets:
            c_name, c_path = cover_sheets[0]
            if c_path in z.namelist():
                c_root = ET.fromstring(z.read(c_path))
                ns_s = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                for r in c_root.findall('.//main:row', ns_s):
                    for c in r.findall('main:c', ns_s):
                        coord = c.attrib.get('r')
                        t = c.attrib.get('t')
                        v = c.find('main:v', ns_s)
                        val = v.text if v is not None else ''
                        if t == 's' and val.isdigit():
                            val = sst[int(val)]
                        val = val.strip()
                        # V2 封面字段解析
                        if coord == 'E3' and val and '举例' not in val:
                            project_code = val
                        elif coord == 'A2' and val:
                            if '机组' in val or '风力' in val or not project_name:
                                project_name = val
                            elif not project_code:
                                project_code = val
                        elif coord == 'A4' and val:
                            if '举例' not in val:
                                system_name = val
                            elif not project_name:
                                project_name = val
                        elif coord in ['B8', 'C8'] and val and 'SBOM' in val:
                            system_name = val
                        elif coord == 'A5' and val:
                            doc_no = val
                        elif coord == 'E5' and val:
                            ecn_no = val
                        elif coord in ['A7', 'A9'] and val:
                            company = val
                        elif coord == 'A11' and val:
                            form_no = val

        # Insert or update project
        cursor.execute('''
        INSERT INTO projects (code, name, system_name, doc_no, ecn_no, form_no, company)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
            name=excluded.name,
            system_name=excluded.system_name,
            company=excluded.company,
            form_no=excluded.form_no
        ''', (project_code, project_name, system_name, doc_no, ecn_no, form_no, company))
        
        cursor.execute('SELECT id FROM projects WHERE code = ?', (project_code,))
        project_id = cursor.fetchone()[0]

        # 2. Parse 签字页与更改页 (Signatures & ECN Records for V2)
        sig_sheets = [s for s in sheet_info if s[0] == '签字页' or ('签字' in s[0] and '修改' not in s[0] and '更改' not in s[0])]
        change_sheets = [s for s in sheet_info if s[0] == '更改页' or '更改' in s[0] or ('修改' in s[0] and '签字' not in s[0])]

        cursor.execute('DELETE FROM signatures WHERE project_id = ?', (project_id,))
        cursor.execute('DELETE FROM ecn_records WHERE project_id = ?', (project_id,))

        if sig_sheets:
            # V2 独立《签字页》
            _, sig_path = sig_sheets[0]
            if sig_path in z.namelist():
                sig_root = ET.fromstring(z.read(sig_path))
                ns_s = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                for r in sig_root.findall('.//main:row', ns_s):
                    row_idx = int(r.attrib.get('r', 0))
                    cells = {}
                    for c in r.findall('main:c', ns_s):
                        col = ''.join([ch for ch in c.attrib.get('r') if ch.isalpha()])
                        t = c.attrib.get('t')
                        v = c.find('main:v', ns_s)
                        val = v.text if v is not None else ''
                        if t == 's' and val.isdigit():
                            val = sst[int(val)]
                        cells[col] = val.strip()

                    role_raw = cells.get('E', '').replace('：', '').replace(':', '').replace('\n', '').replace(' ', '')
                    sign_name = cells.get('F', '')
                    sign_date = cells.get('I', '')
                    if role_raw and (sign_name or sign_date):
                        cursor.execute('INSERT INTO signatures (project_id, role, sign_name, sign_date) VALUES (?, ?, ?, ?)',
                                       (project_id, role_raw, sign_name, sign_date))

        if change_sheets:
            # V2 独立《更改页》
            _, chg_path = change_sheets[0]
            if chg_path in z.namelist():
                chg_root = ET.fromstring(z.read(chg_path))
                ns_s = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                for r in chg_root.findall('.//main:row', ns_s):
                    row_idx = int(r.attrib.get('r', 0))
                    if 8 <= row_idx <= 32:
                        cells = {}
                        for c in r.findall('main:c', ns_s):
                            col = ''.join([ch for ch in c.attrib.get('r') if ch.isalpha()])
                            t = c.attrib.get('t')
                            v = c.find('main:v', ns_s)
                            val = v.text if v is not None else ''
                            if t == 's' and val.isdigit():
                                val = sst[int(val)]
                            cells[col] = val.strip()

                        ecn_no = cells.get('B', '')
                        change_pos = cells.get('F', '')
                        change_desc = cells.get('H', '')
                        changer = cells.get('K', '')
                        change_date = cells.get('M', '')
                        if ecn_no and ecn_no != 'XXXXX':
                            cursor.execute('''
                            INSERT INTO ecn_records (project_id, ecn_no, change_pos, change_desc, changer, change_date)
                            VALUES (?, ?, ?, ?, ?, ?)
                            ''', (project_id, ecn_no, change_pos, change_desc, changer, change_date))

        # 3. Parse BOM Subsystem Sheets (exclude 封面, 签字页, 更改页)
        bom_sheets = [s for s in sheet_info if '封面' not in s[0] and '签字' not in s[0] and '更改' not in s[0] and '修改' not in s[0]]
        
        for sort_order, (sub_name, ws_path) in enumerate(bom_sheets):
            ws_dir = os.path.dirname(ws_path)
            ws_rels_path = f"{ws_dir}/_rels/{os.path.basename(ws_path)}.rels"

            # Parse worksheet rels (for OLE objects and drawing)
            ws_rels = {}
            drawing_rel_target = None
            vml_rel_target = None

            if ws_rels_path in z.namelist():
                for r in ET.fromstring(z.read(ws_rels_path)):
                    r_id = r.attrib.get('Id')
                    r_type = r.attrib.get('Type', '')
                    target = r.attrib.get('Target', '')
                    ws_rels[r_id] = target
                    if r_type.endswith('/drawing'):
                        drawing_rel_target = os.path.normpath(os.path.join(ws_dir, target)).replace('\\', '/')
                    elif r_type.endswith('/vmlDrawing'):
                        vml_rel_target = os.path.normpath(os.path.join(ws_dir, target)).replace('\\', '/')

            # Parse drawing rels (for images)
            dr_rels = {}
            if drawing_rel_target:
                dr_dir = os.path.dirname(drawing_rel_target)
                dr_rels_path = f"{dr_dir}/_rels/{os.path.basename(drawing_rel_target)}.rels"
                if dr_rels_path in z.namelist():
                    for r in ET.fromstring(z.read(dr_rels_path)):
                        dr_rels[r.attrib['Id']] = os.path.normpath(os.path.join(dr_dir, r.attrib['Target'])).replace('\\', '/')

            # Map OLE objects to row numbers
            ws_root = ET.fromstring(z.read(ws_path))
            ns_s = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            
            shape_to_ole_file = {}
            for ole in ws_root.findall('.//main:oleObject', ns_s):
                s_id = ole.attrib.get('shapeId')
                r_id = ole.attrib.get(f'{{{r_ns}}}id')
                if s_id and r_id:
                    target_file = ws_rels.get(r_id, '')
                    if target_file:
                        full_ole_path = os.path.normpath(os.path.join(ws_dir, target_file)).replace('\\', '/')
                        shape_to_ole_file[s_id] = full_ole_path

            row_to_ole = {}
            if vml_rel_target and vml_rel_target in z.namelist():
                vml_content = z.read(vml_rel_target).decode('utf-8', errors='ignore')
                for part in vml_content.split('<v:shape'):
                    if 'id=' in part and 'Anchor' in part:
                        id_str = part.split('id="')[1].split('"')[0]
                        anchor_str = part.split('<x:Anchor>')[1].split('</x:Anchor>')[0]
                        num_id = id_str.split('s')[-1]
                        parts = [p.strip() for p in anchor_str.strip().split(',') if p.strip()]
                        if len(parts) >= 3:
                            row_idx = int(parts[2]) + 1
                            if num_id in shape_to_ole_file:
                                row_to_ole[row_idx] = shape_to_ole_file[num_id]

            # Map drawings (images) to row numbers
            row_to_img = {}
            if drawing_rel_target and drawing_rel_target in z.namelist():
                dr_root = ET.fromstring(z.read(drawing_rel_target))
                ns_dr = {
                    'xdr': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
                    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'
                }
                for anchor in dr_root.findall('xdr:twoCellAnchor', ns_dr):
                    from_col_el = anchor.find('xdr:from/xdr:col', ns_dr)
                    from_row_el = anchor.find('xdr:from/xdr:row', ns_dr)
                    if from_col_el is not None and from_row_el is not None:
                        from_col = int(from_col_el.text)
                        from_row = int(from_row_el.text) + 1
                        blip = anchor.find('.//a:blip', ns_dr)
                        if blip is not None and from_col == 13: # Column N (图片)
                            embed_id = blip.attrib.get(f'{{{r_ns}}}embed')
                            img_path = dr_rels.get(embed_id)
                            if img_path:
                                row_to_img[from_row] = img_path

            # Create or update subsystem
            cursor.execute('''
            INSERT INTO subsystems (project_id, name, sort_order)
            VALUES (?, ?, ?)
            ''', (project_id, sub_name, sort_order))
            subsystem_id = cursor.lastrowid

            # Parse BOM Rows
            hierarchy_stack = []
            for r in ws_root.findall('.//main:row', ns_s):
                row_idx = int(r.attrib.get('r', 0))
                if row_idx < 4:
                    continue
                
                cells = {}
                for c in r.findall('main:c', ns_s):
                    col = ''.join([ch for ch in c.attrib.get('r') if ch.isalpha()])
                    t = c.attrib.get('t')
                    v = c.find('main:v', ns_s)
                    val = v.text if v is not None else ''
                    if t == 's' and val.isdigit():
                        val = sst[int(val)]
                    cells[col] = val.strip()

                mat_no = cells.get('E', '')
                mat_desc = cells.get('F', '')
                if not mat_no and not mat_desc:
                    continue

                if not mat_no:
                    mat_no = f"AUTO_{sub_name}_{row_idx}"

                row_num = int(cells.get('A', row_idx - 3)) if cells.get('A', '').isdigit() else (row_idx - 3)
                level_str = cells.get('B', '••')
                level_num = int(cells.get('C', 2)) if cells.get('C', '').isdigit() else 2
                seq_num = str(cells.get('D', '')).strip() or str(row_num)

                while hierarchy_stack and hierarchy_stack[-1][0] >= level_num:
                    hierarchy_stack.pop()
                parent_mat_no = hierarchy_stack[-1][1] if hierarchy_stack else ''
                hierarchy_stack.append((level_num, mat_no))
                
                name = cells.get('G', '')
                drawing_no = cells.get('H', '/')
                spec_model = cells.get('I', '')
                manufacturer = cells.get('J', '')
                qty = cells.get('K', '1')
                unit = cells.get('L', 'PC')
                if unit.upper() == 'PCS':
                    unit = 'PC'
                notes = cells.get('O', '')
                substitute = cells.get('P', '')

                # Extract and save Image if present
                saved_img_rel = ''
                if row_idx in row_to_img:
                    raw_img_path = row_to_img[row_idx]
                    if raw_img_path in z.namelist():
                        ext = os.path.splitext(raw_img_path)[1].lower()
                        img_filename = f"{mat_no}{ext}"
                        img_dest = os.path.join(IMAGES_DIR, img_filename)
                        with open(img_dest, 'wb') as f_out:
                            f_out.write(z.read(raw_img_path))
                        saved_img_rel = f"assets/images/{img_filename}"

                # Extract and save Manual PDF if present
                saved_manual_rel = ''
                if row_idx in row_to_ole:
                    raw_ole_path = row_to_ole[row_idx]
                    if raw_ole_path in z.namelist():
                        ole_data = z.read(raw_ole_path)
                        pdf_start = ole_data.find(b'%PDF')
                        eof_idx = ole_data.rfind(b'%%EOF')
                        if pdf_start != -1 and eof_idx != -1:
                            pdf_bytes = ole_data[pdf_start:eof_idx + 6]
                            pdf_filename = f"{mat_no}.pdf"
                            pdf_dest = os.path.join(MANUALS_DIR, pdf_filename)
                            with open(pdf_dest, 'wb') as f_out:
                                f_out.write(pdf_bytes)
                            saved_manual_rel = f"assets/manuals/{pdf_filename}"

                # Insert or update Materials master library
                cursor.execute('''
                INSERT INTO materials (material_no, description, name, spec_model, manufacturer, unit, drawing_no, image_path, manual_path, substitute, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(material_no) DO UPDATE SET
                    description=COALESCE(NULLIF(excluded.description, ''), materials.description),
                    name=COALESCE(NULLIF(excluded.name, ''), materials.name),
                    spec_model=COALESCE(NULLIF(excluded.spec_model, ''), materials.spec_model),
                    manufacturer=COALESCE(NULLIF(excluded.manufacturer, ''), materials.manufacturer),
                    unit=COALESCE(NULLIF(excluded.unit, ''), materials.unit),
                    drawing_no=CASE WHEN excluded.drawing_no != '' AND excluded.drawing_no != '/' THEN excluded.drawing_no ELSE materials.drawing_no END,
                    image_path=CASE WHEN excluded.image_path != '' THEN excluded.image_path ELSE materials.image_path END,
                    manual_path=CASE WHEN excluded.manual_path != '' THEN excluded.manual_path ELSE materials.manual_path END,
                    substitute=COALESCE(NULLIF(excluded.substitute, ''), materials.substitute),
                    notes=COALESCE(NULLIF(excluded.notes, ''), materials.notes)
                ''', (mat_no, mat_desc, name, spec_model, manufacturer, unit, drawing_no, saved_img_rel, saved_manual_rel, substitute, notes))

                # Insert into bom_items
                cursor.execute('''
                INSERT INTO bom_items (subsystem_id, row_num, level_str, level_num, parent_material_no, seq_num, material_no, drawing_no, qty, unit, notes, substitute)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (subsystem_id, row_num, level_str, level_num, parent_mat_no, seq_num, mat_no, drawing_no, qty, unit, notes, substitute))

                if parent_mat_no:
                    cursor.execute('''
                    SELECT id FROM material_structures WHERE parent_material_no = ? AND child_material_no = ?
                    ''', (parent_mat_no, mat_no))
                    if not cursor.fetchone():
                        cursor.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM material_structures WHERE parent_material_no = ?', (parent_mat_no,))
                        next_sort = cursor.fetchone()[0]
                        cursor.execute('''
                        INSERT INTO material_structures (parent_material_no, child_material_no, child_level_num, child_level_str, sort_order, qty, unit, drawing_no, notes, substitute)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (parent_mat_no, mat_no, level_num, level_str, next_sort, qty, unit, drawing_no, notes, substitute))

        conn.commit()
        conn.close()
        print(f"Successfully imported '{excel_path}' into database!")
        print(f"Project Code: {project_code}, Subsystems imported: {[s[0] for s in bom_sheets]}")

if __name__ == '__main__':
    default_excel = find_template_path()
    if default_excel and os.path.exists(default_excel):
        import_excel_sbom(default_excel)
    else:
        print("Template file not found!")
