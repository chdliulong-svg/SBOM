import os
import zipfile
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.drawing.image import Image as OpenpyxlImage
from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.utils.units import pixels_to_EMU
from PIL import Image as PILImage
from .database import get_db, find_template_path

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def ensure_company_logo(tpl_path):
    """
    Extracts the company logo from the template file if not already present.
    """
    logo_path = os.path.join(BASE_DIR, 'assets', 'company_logo.png')
    if not os.path.exists(logo_path) and tpl_path and os.path.exists(tpl_path):
        try:
            with zipfile.ZipFile(tpl_path, 'r') as z:
                # In template, xl/media/image1.png is the company logo
                if 'xl/media/image1.png' in z.namelist():
                    os.makedirs(os.path.dirname(logo_path), exist_ok=True)
                    with open(logo_path, 'wb') as f:
                        f.write(z.read('xl/media/image1.png'))
        except Exception as e:
            print("Warning extracting logo:", e)
    return logo_path

def export_project_sbom(project_id, output_path):
    """
    Exports the project and all its subsystems to a standardized Excel workbook
    strictly preserving the original template's Cover (封面), Signatures & ECN (签字及修改页),
    formulas, merged cells, fonts, borders, layouts, and company logos.
    """
    conn = get_db()
    cursor = conn.cursor()

    # 1. Fetch project info
    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    project = cursor.fetchone()
    if not project:
        conn.close()
        raise ValueError(f"未找到ID为 {project_id} 的项目。")

    # 2. Locate and load the original template
    tpl_path = find_template_path()
    if not tpl_path or not os.path.exists(tpl_path):
        conn.close()
        raise FileNotFoundError("未在'Excel 模版'目录或根目录下找到SBOM模版文件，请确认模版文件存在！")

    wb = openpyxl.load_workbook(tpl_path)
    company_logo_path = ensure_company_logo(tpl_path)

    # Standard borders and fonts for data cells
    thin_border = Border(
        left=Side(style='thin', color='A0A0A0'),
        right=Side(style='thin', color='A0A0A0'),
        top=Side(style='thin', color='A0A0A0'),
        bottom=Side(style='thin', color='A0A0A0')
    )
    song_font = Font(name='宋体', size=10)
    tnr_font = Font(name='Times New Roman', size=10)
    level_font = Font(name='Times New Roman', size=11)
    link_font = Font(name='微软雅黑', size=9, color='0055CC', underline='single')

    # ================= 1. 封面 (Cover) =================
    # Locate 封面 sheet
    cover_sheets = [name for name in wb.sheetnames if '封面' in name]
    if cover_sheets:
        ws_cover = wb[cover_sheets[0]]
        # In-place dynamic values strictly retaining original template formatting,
        # merges (A2:D2, A4:D4, A9:D9, A11:B11), fonts, and logo
        ws_cover['A2'].value = project['code'] or 'EW6.25-220'
        ws_cover['A4'].value = project['name'] or '风力发电机组'
        ws_cover['C6'].value = project['doc_no'] or ''
        ws_cover['C7'].value = project['ecn_no'] or ''
        # Ensure ECN No (C7) strictly uses the exact same font (宋体, 16pt) as Document No (C6)
        c6_font = ws_cover['C6'].font
        target_name = c6_font.name if (c6_font and c6_font.name) else '宋体'
        target_size = c6_font.size if (c6_font and c6_font.size) else 16.0
        ws_cover['C7'].font = Font(name=target_name, size=target_size, bold=False)
        ws_cover['C8'].value = project['system_name'] or ''
        ws_cover['A9'].value = project['company'] or '上海电气风电集团股份有限公司'
        ws_cover['A11'].value = project['form_no'] or '  FDJL-JS-037'

    # ================= 2. 签字及修改页 (Signatures & ECN) =================
    sig_sheets = [name for name in wb.sheetnames if '签字' in name or '修改' in name]
    if sig_sheets:
        ws_sig = wb[sig_sheets[0]]
        # Clear rows 3 to 32 ECN slots
        for r in range(3, 33):
            ws_sig[f'A{r}'].value = None
            ws_sig[f'E{r}'].value = None
            ws_sig[f'I{r}'].value = None
            ws_sig[f'K{r}'].value = None

        # Fetch and write ECN records
        cursor.execute('SELECT * FROM ecn_records WHERE project_id = ? ORDER BY id', (project_id,))
        ecn_list = cursor.fetchall()
        for i, ecn in enumerate(ecn_list):
            r = 3 + i
            if r <= 32:
                ws_sig[f'A{r}'].value = ecn['ecn_no']
                ws_sig[f'E{r}'].value = ecn['change_desc']
                ws_sig[f'I{r}'].value = ecn['changer']
                ws_sig[f'K{r}'].value = ecn['change_date']

        # Fetch and write Signatures into designated cells (rows 33 to 35)
        # Row 33: 编制 (C33=签字, D33=日期)
        # Row 34: 校核 (C34=签字, D34=日期)
        # Row 35: 审定 (C35=签字, D35=日期)
        # Note: F33 has formula =封面!C8, J33 has formula =封面!C6, all intact!
        cursor.execute('SELECT * FROM signatures WHERE project_id = ?', (project_id,))
        sigs = {s['role']: (s['sign_name'], s['sign_date']) for s in cursor.fetchall()}

        ws_sig['C33'].value = sigs.get('编制', ('', ''))[0]
        ws_sig['D33'].value = sigs.get('编制', ('', ''))[1]
        ws_sig['C34'].value = sigs.get('校核', ('', ''))[0]
        ws_sig['D34'].value = sigs.get('校核', ('', ''))[1]
        ws_sig['C35'].value = sigs.get('审定', ('', ''))[0]
        ws_sig['D35'].value = sigs.get('审定', ('', ''))[1]

    # ================= 3. BOM Subsystem Sheets =================
    cursor.execute('SELECT * FROM subsystems WHERE project_id = ? ORDER BY sort_order, id', (project_id,))
    subsystems = cursor.fetchall()

    # Identify prototype BOM template sheet (e.g. 盘古SBOM or first BOM sheet)
    proto_candidates = [name for name in wb.sheetnames if name not in cover_sheets and name not in sig_sheets]
    proto_sheet = wb[proto_candidates[0]] if proto_candidates else None

    # Track sheet names in this export
    exported_sub_sheets = []

    for sub in subsystems:
        sub_name = sub['name']
        exported_sub_sheets.append(sub_name)

        if sub_name in wb.sheetnames:
            ws = wb[sub_name]
            # Keep company logo (Image 0), clear old template product sample images
            if len(ws._images) > 0:
                ws._images = [ws._images[0]]
            else:
                ws._images = []
        elif proto_sheet is not None:
            # Create sheet by copying prototype template sheet
            ws = wb.copy_worksheet(proto_sheet)
            ws.title = sub_name
            # Copy company logo to new sheet
            if os.path.exists(company_logo_path):
                logo_img = OpenpyxlImage(company_logo_path)
                logo_img.width = 212
                logo_img.height = 76
                ws.add_image(logo_img, 'A1')
        else:
            ws = wb.create_sheet(title=sub_name)

        # Clear old template sample data rows 4+
        if ws.max_row >= 4:
            ws.delete_rows(4, ws.max_row - 3)

        # Update headers in row 1 & row 2
        ws['F1'].value = project['company'] or '上海电气风电集团股份有限公司'
        sub_doc_no = (sub['doc_no'] or '').strip() or (project['doc_no'] or '').strip() or '/'
        ws['I1'].value = sub_doc_no
        ws['M1'].value = project['ecn_no'] or ''
        
        if sub['system_title']:
            ws['I2'].value = sub['system_title']
        elif sub_name == 'SBOM':
            ws['I2'].value = project['system_name'] or f"{project['code']}变桨轴承润滑系统"
        elif sub_name.endswith('SBOM'):
            ws['I2'].value = f"{project['code']}{sub_name[:-4]}变桨轴承润滑系统"
        else:
            ws['I2'].value = f"{project['code']}{sub_name}润滑系统"

        # Standardize Row 3 header fonts: ensure uniform 12pt bold font across all columns
        for c in range(1, 17):
            h_cell = ws.cell(row=3, column=c)
            if h_cell.value:
                cur_name = h_cell.font.name if (h_cell.font and h_cell.font.name in ['Times New Roman', '宋体']) else 'Times New Roman'
                h_cell.font = Font(
                    name=cur_name,
                    size=12.0,
                    bold=True,
                    color=h_cell.font.color if (h_cell.font and h_cell.font.color) else None
                )

        # Fetch BOM items with material master details
        cursor.execute('''
        SELECT b.*, m.name as m_name, m.description as m_desc, m.spec_model as m_model,
               m.manufacturer as m_mfr, m.unit as m_unit, m.image_path, m.manual_path,
               m.drawing_no as m_drawing_no
        FROM bom_items b
        LEFT JOIN materials m ON b.material_no = m.material_no
        WHERE b.subsystem_id = ?
        ORDER BY b.row_num, b.id
        ''', (sub['id'],))
        bom_items = cursor.fetchall()

        # Check duplicate material numbers within this subsystem
        sub_mat_counts = {}
        for it in bom_items:
            m_no = (it['material_no'] or '').strip()
            if m_no:
                sub_mat_counts[m_no] = sub_mat_counts.get(m_no, 0) + 1

        dup_mat_fill = PatternFill(start_color='FFF2CC', end_color='FFF2CC', fill_type='solid')
        dup_mat_font = Font(name='Times New Roman', size=10, bold=True, color='9A3412')

        # Dynamically detect image column from Row 3 headers
        from openpyxl.utils import get_column_letter
        img_col_idx = 13  # Default Column N (0-based 13)
        img_col_letter = 'N'
        for c in range(1, 26):
            header_val = str(ws.cell(row=3, column=c).value or '').strip()
            if any(k in header_val for k in ['图片', '照片', '实物图', '外观图']) or header_val == '图':
                img_col_idx = c - 1
                img_col_letter = get_column_letter(c)
                break

        # Calculate actual cell width in pixels from template column dimensions
        col_dim = ws.column_dimensions.get(img_col_letter)
        col_w_unit = float(col_dim.width) if (col_dim and col_dim.width is not None) else 29.0
        # Standard Excel 96 DPI: 1 width unit ≈ 7.5px + 5px padding
        cell_w = max(40, int(col_w_unit * 7.5 + 5))

        for idx, item in enumerate(bom_items):
            r = 4 + idx
            ws.row_dimensions[r].height = 70  # Standard ample height for clear images
            row_h_pt = float(ws.row_dimensions[r].height or 70)
            cell_h = max(30, int(row_h_pt * 96 / 72))

            level_num_val = item['level_num'] or 1
            level_str_val = item['level_str'] or ('•' * level_num_val)
            is_dup_row = sub_mat_counts.get((item['material_no'] or '').strip(), 0) > 1

            row_data = [
                ('A', item['row_num'], tnr_font, Alignment(horizontal='center', vertical='center')),
                ('B', level_str_val, level_font, Alignment(horizontal='right', vertical='center')),
                ('C', level_num_val, level_font, Alignment(horizontal='left', vertical='center')),
                ('D', item['seq_num'] or item['row_num'], tnr_font, Alignment(horizontal='center', vertical='center')),
                ('E', item['material_no'], tnr_font, Alignment(horizontal='center', vertical='center')),
                ('F', item['m_desc'] or '', song_font, Alignment(horizontal='center', vertical='center', wrap_text=True)),
                ('G', item['m_name'] or '', song_font, Alignment(horizontal='center', vertical='center', wrap_text=True)),
                ('H', (item['drawing_no'] if (item['drawing_no'] and item['drawing_no'] != '/') else (item['m_drawing_no'] or '/')), song_font, Alignment(horizontal='center', vertical='center', wrap_text=True)),
                ('I', item['m_model'] or '', song_font, Alignment(horizontal='center', vertical='center', wrap_text=True)),
                ('J', item['m_mfr'] or '', song_font, Alignment(horizontal='center', vertical='center', wrap_text=True)),
                ('K', item['qty'], song_font, Alignment(horizontal='center', vertical='center')),
                ('L', item['unit'] or item['m_unit'] or 'PCS', tnr_font, Alignment(horizontal='center', vertical='center')),
                ('M', '', tnr_font, Alignment(horizontal='center', vertical='center')),
                ('N', '', tnr_font, Alignment(horizontal='center', vertical='center')),
                ('O', item['notes'] or '', song_font, Alignment(horizontal='center', vertical='center', wrap_text=True)),
                ('P', item['substitute'] or '', song_font, Alignment(horizontal='left', vertical='center', wrap_text=True))
            ]

            for col_letter, val, font_obj, align_obj in row_data:
                cell = ws[f'{col_letter}{r}']
                cell.value = val
                cell.font = font_obj
                cell.alignment = align_obj
                cell.border = thin_border
                if is_dup_row and col_letter == 'E':
                    cell.fill = dup_mat_fill
                    cell.font = dup_mat_font

            # Column M: Manual Link / Info
            manual_path = item['manual_path']
            if manual_path:
                full_m_path = os.path.join(BASE_DIR, manual_path)
                if os.path.exists(full_m_path):
                    m_cell = ws[f'M{r}']
                    m_cell.value = '查看技术手册'
                    m_cell.font = link_font
                    m_cell.alignment = Alignment(horizontal='center', vertical='center')
                    # Relative hyperlink for clean opening in Excel
                    m_cell.hyperlink = manual_path.replace('/', '\\')

            # Image Embedding (Proportionally resized and dynamically centered into cell)
            img_path = item['image_path']
            if img_path:
                full_img_path = os.path.join(BASE_DIR, img_path)
                if os.path.exists(full_img_path) and os.path.splitext(full_img_path)[1].lower() in ['.png', '.jpg', '.jpeg']:
                    try:
                        with PILImage.open(full_img_path) as pil_img:
                            orig_w, orig_h = pil_img.size
                            # Safe margins: leave 8px horizontally on each side, 6px vertically
                            max_w = max(20, cell_w - 16)
                            max_h = max(20, cell_h - 12)
                            scale = min(max_w / orig_w, max_h / orig_h)
                            new_w = max(1, int(orig_w * scale))
                            new_h = max(1, int(orig_h * scale))

                        excel_img = OpenpyxlImage(full_img_path)
                        excel_img.width = new_w
                        excel_img.height = new_h

                        # Calculate horizontal and vertical centering offset inside the actual cell dimensions
                        offset_x = max(0, (cell_w - new_w) // 2)
                        offset_y = max(0, (cell_h - new_h) // 2)

                        marker = AnchorMarker(
                            col=img_col_idx,
                            colOff=pixels_to_EMU(offset_x),
                            row=r - 1,
                            rowOff=pixels_to_EMU(offset_y)
                        )
                        size = XDRPositiveSize2D(pixels_to_EMU(new_w), pixels_to_EMU(new_h))
                        excel_img.anchor = OneCellAnchor(_from=marker, ext=size)
                        ws.add_image(excel_img)
                    except Exception as e:
                        print(f"Warning: failed to add image for {item['material_no']}: {e}")

    # ================= 4. Cleanup and Reorder Sheets =================
    # Remove any extra template sample BOM sheets that are not in the current project's subsystems
    keep_sheets = set(cover_sheets + sig_sheets + exported_sub_sheets)
    sheets_to_remove = [name for name in wb.sheetnames if name not in keep_sheets]
    for sname in sheets_to_remove:
        wb.remove(wb[sname])

    # Ensure precise ordering: 封面 -> 签字及修改页 -> 各子系统
    desired_order = []
    for s in cover_sheets:
        if s in wb.sheetnames and s not in desired_order:
            desired_order.append(s)
    for s in sig_sheets:
        if s in wb.sheetnames and s not in desired_order:
            desired_order.append(s)
    for s in exported_sub_sheets:
        if s in wb.sheetnames and s not in desired_order:
            desired_order.append(s)
    for s in wb.sheetnames:
        if s not in desired_order:
            desired_order.append(s)

    wb._sheets = [wb[name] for name in desired_order]

    conn.close()
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    wb.save(output_path)
    print(f"Exported successfully to: {output_path}")
    return output_path

if __name__ == '__main__':
    test_out = os.path.join(BASE_DIR, 'exports', 'test_export_sbom.xlsx')
    export_project_sbom(1, test_out)
