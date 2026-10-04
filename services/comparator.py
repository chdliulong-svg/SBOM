import io
import time
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter
from .database import get_db

def parse_float_qty(val):
    """Safely parse a quantity value to float."""
    if val is None:
        return 0.0
    s = str(val).strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0

def format_qty_display(val):
    """Format float quantity into clean integer or rounded string."""
    if val is None:
        return '0'
    try:
        f = float(val)
        if f.is_integer():
            return str(int(f))
        return f"{f:.3f}".rstrip('0').rstrip('.')
    except Exception:
        return str(val)

def compare_projects(proj_a_id, proj_b_id, subsystem_filter='all'):
    """
    Compares two engineering projects' BOMs (Project A vs Project B).
    Supports all-subsystems aggregation or specific subsystem filtering.
    Returns a comprehensive structured diff result.
    """
    conn = get_db()
    cursor = conn.cursor()

    try:
        # 1. Fetch Project A & B metadata
        cursor.execute('SELECT * FROM projects WHERE id = ?', (proj_a_id,))
        proj_a = cursor.fetchone()
        cursor.execute('SELECT * FROM projects WHERE id = ?', (proj_b_id,))
        proj_b = cursor.fetchone()

        if not proj_a:
            raise ValueError(f"基准项目 (ID: {proj_a_id}) 不存在或已被删除")
        if not proj_b:
            raise ValueError(f"比对项目 (ID: {proj_b_id}) 不存在或已被删除")

        proj_a_name = proj_a['system_name'] or proj_a['name'] or proj_a['code'] or f"项目-{proj_a_id}"
        proj_b_name = proj_b['system_name'] or proj_b['name'] or proj_b['code'] or f"项目-{proj_b_id}"

        # 2. Fetch subsystems for each project
        cursor.execute('SELECT id, name, sort_order FROM subsystems WHERE project_id = ? ORDER BY sort_order, id', (proj_a_id,))
        subs_a = [dict(r) for r in cursor.fetchall()]
        cursor.execute('SELECT id, name, sort_order FROM subsystems WHERE project_id = ? ORDER BY sort_order, id', (proj_b_id,))
        subs_b = [dict(r) for r in cursor.fetchall()]

        names_a = [s['name'] for s in subs_a]
        names_b = [s['name'] for s in subs_b]
        all_sub_names = list(dict.fromkeys(names_a + names_b))

        # Determine target subsystem IDs
        sub_filter = (subsystem_filter or 'all').strip()
        if sub_filter != 'all':
            target_subs_a = [s['id'] for s in subs_a if s['name'] == sub_filter]
            target_subs_b = [s['id'] for s in subs_b if s['name'] == sub_filter]
        else:
            target_subs_a = [s['id'] for s in subs_a]
            target_subs_b = [s['id'] for s in subs_b]

        # 3. Fetch BOM items for Project A
        items_a = []
        if target_subs_a:
            placeholders_a = ','.join('?' for _ in target_subs_a)
            cursor.execute(f'''
                SELECT b.*,
                       s.name as subsystem_name,
                       m.name as m_name,
                       m.description as m_desc,
                       m.spec_model as m_model,
                       m.manufacturer as m_mfr,
                       m.unit as m_unit,
                       m.drawing_no as m_dwg,
                       m.substitute as m_sub,
                       m.image_path,
                       m.manual_path
                FROM bom_items b
                LEFT JOIN subsystems s ON b.subsystem_id = s.id
                LEFT JOIN materials m ON b.material_no = m.material_no
                WHERE b.subsystem_id IN ({placeholders_a})
                ORDER BY b.row_num, b.id
            ''', target_subs_a)
            items_a = [dict(r) for r in cursor.fetchall()]

        # 4. Fetch BOM items for Project B
        items_b = []
        if target_subs_b:
            placeholders_b = ','.join('?' for _ in target_subs_b)
            cursor.execute(f'''
                SELECT b.*,
                       s.name as subsystem_name,
                       m.name as m_name,
                       m.description as m_desc,
                       m.spec_model as m_model,
                       m.manufacturer as m_mfr,
                       m.unit as m_unit,
                       m.drawing_no as m_dwg,
                       m.substitute as m_sub,
                       m.image_path,
                       m.manual_path
                FROM bom_items b
                LEFT JOIN subsystems s ON b.subsystem_id = s.id
                LEFT JOIN materials m ON b.material_no = m.material_no
                WHERE b.subsystem_id IN ({placeholders_b})
                ORDER BY b.row_num, b.id
            ''', target_subs_b)
            items_b = [dict(r) for r in cursor.fetchall()]

        # 5. Group by material_no
        def group_items_by_mat(raw_items):
            group = {}
            for it in raw_items:
                mat_no = (it['material_no'] or '').strip()
                if not mat_no:
                    continue
                mat_key = mat_no.lower()
                if mat_key not in group:
                    group[mat_key] = {
                        'material_no': mat_no,
                        'total_qty': 0.0,
                        'unit': (it['unit'] or it['m_unit'] or 'PCS').strip(),
                        'level_num': it['level_num'] or 2,
                        'level_str': it['level_str'] or '••',
                        'drawing_no': (it['drawing_no'] or it['m_dwg'] or '/').strip(),
                        'notes': (it['notes'] or '').strip(),
                        'substitute': (it['substitute'] or it['m_sub'] or '').strip(),
                        'name': (it['m_name'] or '').strip(),
                        'description': (it['m_desc'] or '').strip(),
                        'spec_model': (it['m_model'] or '').strip(),
                        'manufacturer': (it['m_mfr'] or '').strip(),
                        'image_path': it.get('image_path') or '',
                        'manual_path': it.get('manual_path') or '',
                        'subsystems': [],
                        'rows': []
                    }

                entry = group[mat_key]
                qty_f = parse_float_qty(it['qty'])
                entry['total_qty'] += qty_f
                sub_name = it['subsystem_name'] or '默认'
                if sub_name not in entry['subsystems']:
                    entry['subsystems'].append(sub_name)

                # Track highest-priority level (smaller number = higher level)
                if it['level_num'] and it['level_num'] < entry['level_num']:
                    entry['level_num'] = it['level_num']
                    entry['level_str'] = it['level_str']

                entry['rows'].append({
                    'id': it['id'],
                    'subsystem_id': it['subsystem_id'],
                    'subsystem_name': sub_name,
                    'row_num': it['row_num'],
                    'seq_num': it['seq_num'],
                    'level_num': it['level_num'],
                    'level_str': it['level_str'],
                    'qty': it['qty'],
                    'unit': it['unit'],
                    'drawing_no': it['drawing_no'],
                    'notes': it['notes'],
                    'substitute': it['substitute']
                })
            return group

        map_a = group_items_by_mat(items_a)
        map_b = group_items_by_mat(items_b)

        # 6. Compare all distinct materials
        all_mat_keys = list(dict.fromkeys(list(map_a.keys()) + list(map_b.keys())))
        
        diff_items = []
        count_added = 0
        count_removed = 0
        count_modified = 0
        count_same = 0

        for key in all_mat_keys:
            in_a = key in map_a
            in_b = key in map_b
            info_a = map_a.get(key)
            info_b = map_b.get(key)

            # Resolve representative material metadata
            mat_no = (info_a or info_b)['material_no']
            name = (info_a or info_b)['name']
            description = (info_a or info_b)['description']
            spec_model = (info_a or info_b)['spec_model']
            manufacturer = (info_a or info_b)['manufacturer']
            image_path = (info_a or info_b)['image_path']
            manual_path = (info_a or info_b)['manual_path']

            diff_entry = {
                'material_no': mat_no,
                'name': name,
                'description': description,
                'spec_model': spec_model,
                'manufacturer': manufacturer,
                'image_path': image_path,
                'manual_path': manual_path,
                'status': 'same',       # 'added', 'removed', 'modified', 'same'
                'status_label': '一致',
                'diff_changes': [],
                'qty_diff': 0.0,
                'qty_diff_text': '0',
                'a': None,
                'b': None
            }

            if in_a:
                diff_entry['a'] = {
                    'exists': True,
                    'total_qty': info_a['total_qty'],
                    'total_qty_str': format_qty_display(info_a['total_qty']),
                    'unit': info_a['unit'],
                    'level_num': info_a['level_num'],
                    'level_str': info_a['level_str'],
                    'drawing_no': info_a['drawing_no'],
                    'subsystems': info_a['subsystems'],
                    'notes': info_a['notes'],
                    'substitute': info_a['substitute'],
                    'occurrences_count': len(info_a['rows'])
                }

            if in_b:
                diff_entry['b'] = {
                    'exists': True,
                    'total_qty': info_b['total_qty'],
                    'total_qty_str': format_qty_display(info_b['total_qty']),
                    'unit': info_b['unit'],
                    'level_num': info_b['level_num'],
                    'level_str': info_b['level_str'],
                    'drawing_no': info_b['drawing_no'],
                    'subsystems': info_b['subsystems'],
                    'notes': info_b['notes'],
                    'substitute': info_b['substitute'],
                    'occurrences_count': len(info_b['rows'])
                }

            # Classify diff
            if in_b and not in_a:
                # Added in B
                count_added += 1
                diff_entry['status'] = 'added'
                diff_entry['status_label'] = '目标新增'
                diff_entry['qty_diff'] = info_b['total_qty']
                diff_entry['qty_diff_text'] = f"+{format_qty_display(info_b['total_qty'])}"
                diff_entry['diff_changes'].append({
                    'type': 'added',
                    'field': 'material',
                    'desc': f"仅在目标项目【{proj_b_name}】中存在 (新增)"
                })

            elif in_a and not in_b:
                # Removed in B
                count_removed += 1
                diff_entry['status'] = 'removed'
                diff_entry['status_label'] = '目标减少'
                diff_entry['qty_diff'] = -info_a['total_qty']
                diff_entry['qty_diff_text'] = f"-{format_qty_display(info_a['total_qty'])}"
                diff_entry['diff_changes'].append({
                    'type': 'removed',
                    'field': 'material',
                    'desc': f"仅在基准项目【{proj_a_name}】中存在 (目标项目缺失)"
                })

            else:
                # In both A and B -> Compare attributes
                changes = []

                # 1. Quantity comparison
                diff_q = info_b['total_qty'] - info_a['total_qty']
                if abs(diff_q) > 1e-4:
                    sign = '+' if diff_q > 0 else ''
                    q_text = f"{sign}{format_qty_display(diff_q)}"
                    diff_entry['qty_diff'] = diff_q
                    diff_entry['qty_diff_text'] = q_text
                    changes.append({
                        'type': 'qty',
                        'field': '数量',
                        'desc': f"数量不同: A ({format_qty_display(info_a['total_qty'])} {info_a['unit']}) → B ({format_qty_display(info_b['total_qty'])} {info_b['unit']}) [差额: {q_text}]"
                    })
                else:
                    diff_entry['qty_diff'] = 0.0
                    diff_entry['qty_diff_text'] = '0'

                # 2. Level comparison
                if info_a['level_num'] != info_b['level_num']:
                    changes.append({
                        'type': 'level',
                        'field': '层级',
                        'desc': f"层级不同: A ({info_a['level_str']} {info_a['level_num']}级) → B ({info_b['level_str']} {info_b['level_num']}级)"
                    })

                # 3. Unit comparison
                if info_a['unit'].lower() != info_b['unit'].lower():
                    changes.append({
                        'type': 'unit',
                        'field': '单位',
                        'desc': f"单位不同: A ({info_a['unit']}) → B ({info_b['unit']})"
                    })

                # 4. Drawing No comparison
                dwg_a = (info_a['drawing_no'] or '').replace('/', '').strip()
                dwg_b = (info_b['drawing_no'] or '').replace('/', '').strip()
                if dwg_a != dwg_b:
                    changes.append({
                        'type': 'drawing_no',
                        'field': '图号',
                        'desc': f"图纸代号不同: A ({info_a['drawing_no'] or '/'}) → B ({info_b['drawing_no'] or '/'})"
                    })

                # 5. Subsystems (Sheets) distribution comparison
                set_a = set(info_a['subsystems'])
                set_b = set(info_b['subsystems'])
                if set_a != set_b:
                    changes.append({
                        'type': 'subsystems',
                        'field': '子系统',
                        'desc': f"所属Sheet不同: A [{', '.join(info_a['subsystems'])}] → B [{', '.join(info_b['subsystems'])}]"
                    })

                # 6. Notes comparison
                if info_a['notes'] != info_b['notes'] and (info_a['notes'] or info_b['notes']):
                    changes.append({
                        'type': 'notes',
                        'field': '备注',
                        'desc': f"技术备注不同: A [{info_a['notes'] or '-'}] → B [{info_b['notes'] or '-'}]"
                    })

                # 7. Substitute comparison
                if info_a['substitute'] != info_b['substitute'] and (info_a['substitute'] or info_b['substitute']):
                    changes.append({
                        'type': 'substitute',
                        'field': '替代件',
                        'desc': f"替代物料不同: A [{info_a['substitute'] or '-'}] → B [{info_b['substitute'] or '-'}]"
                    })

                if changes:
                    count_modified += 1
                    diff_entry['status'] = 'modified'
                    diff_entry['status_label'] = '属性差异'
                    diff_entry['diff_changes'] = changes
                else:
                    count_same += 1
                    diff_entry['status'] = 'same'
                    diff_entry['status_label'] = '完全一致'
                    diff_entry['diff_changes'] = []

            diff_items.append(diff_entry)

        # 7. Sort: modified -> added -> removed -> same
        status_rank = {'modified': 1, 'added': 2, 'removed': 3, 'same': 4}
        diff_items.sort(key=lambda x: (status_rank.get(x['status'], 9), x['material_no'].lower()))

        # 8. Compute total quantities
        total_qty_a = sum(parse_float_qty(it['qty']) for it in items_a)
        total_qty_b = sum(parse_float_qty(it['qty']) for it in items_b)

        result = {
            'success': True,
            'compare_time': time.strftime('%Y-%m-%d %H:%M:%S'),
            'subsystem_filter': sub_filter,
            'all_subsystem_names': all_sub_names,
            'project_a': {
                'id': proj_a['id'],
                'name': proj_a['name'] or '风力发电机组',
                'system_name': proj_a['system_name'] or '',
                'code': proj_a['code'] or '',
                'display_name': proj_a_name,
                'form_no': proj_a['form_no'] or 'FDJL-JS-037',
                'subsystem_count': len(subs_a),
                'material_types_count': len(map_a),
                'total_pieces': format_qty_display(total_qty_a)
            },
            'project_b': {
                'id': proj_b['id'],
                'name': proj_b['name'] or '风力发电机组',
                'system_name': proj_b['system_name'] or '',
                'code': proj_b['code'] or '',
                'display_name': proj_b_name,
                'form_no': proj_b['form_no'] or 'FDJL-JS-037',
                'subsystem_count': len(subs_b),
                'material_types_count': len(map_b),
                'total_pieces': format_qty_display(total_qty_b)
            },
            'summary': {
                'total_unique': len(diff_items),
                'added': count_added,
                'removed': count_removed,
                'modified': count_modified,
                'same': count_same,
                'diff_total': count_added + count_removed + count_modified
            },
            'items': diff_items
        }

        return result
    finally:
        conn.close()

def generate_comparison_excel(result):
    """
    Generates a beautifully styled Excel workbook for the BOM comparison result.
    Contains:
      - Sheet 1: 汇总对比概况 (Overview & Statistics)
      - Sheet 2: 差异明细清单 (Differences Only: Added, Removed, Modified)
      - Sheet 3: 全部物料对齐总表 (All Materials Side-by-Side)
    Returns: (BytesIO buffer, filename)
    """
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    proj_a = result['project_a']
    proj_b = result['project_b']
    summary = result['summary']
    items = result['items']
    sub_filter = result['subsystem_filter']
    filter_label = '全部子系统 (整机汇总)' if sub_filter == 'all' else f"子系统 Sheet: {sub_filter}"

    # Colors & Fills
    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    sub_header_fill = PatternFill(start_color="3B82F6", end_color="3B82F6", fill_type="solid")
    added_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")     # soft green
    removed_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")   # soft red
    modified_fill = PatternFill(start_color="FEF9C3", end_color="FEF9C3", fill_type="solid")  # soft yellow
    zebra_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

    font_title = Font(name="微软雅黑", size=16, bold=True, color="1E3A8A")
    font_sub = Font(name="微软雅黑", size=10, color="64748B")
    font_h1 = Font(name="微软雅黑", size=11, bold=True, color="FFFFFF")
    font_bold = Font(name="微软雅黑", size=10, bold=True, color="1E293B")
    font_normal = Font(name="微软雅黑", size=10, color="1E293B")
    font_mono = Font(name="Consolas", size=10, color="0F172A")
    font_green = Font(name="微软雅黑", size=10, bold=True, color="15803D")
    font_red = Font(name="微软雅黑", size=10, bold=True, color="B91C1C")
    font_yellow = Font(name="微软雅黑", size=10, bold=True, color="B45309")

    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )
    thick_bottom = Border(bottom=Side(style='medium', color='1E3A8A'))

    # ========================================================
    # Sheet 1: 汇总对比概况 (Overview)
    # ========================================================
    ws_sum = wb.create_sheet(title="比对概况与统计")
    ws_sum.views.sheetView[0].showGridLines = True

    # Title
    ws_sum['A2'] = "工程项目 Service BOM 比对分析报告"
    ws_sum['A2'].font = font_title
    ws_sum['A3'] = f"生成时间: {result['compare_time']}    |    比对范围: {filter_label}"
    ws_sum['A3'].font = font_sub

    # Table 1: Project Metadata
    ws_sum['A5'] = "比对项目信息"
    ws_sum['A5'].font = font_bold
    headers_proj = ["对比维度", "基准项目 (项目 A)", "比对项目 (项目 B)"]
    for col_idx, h in enumerate(headers_proj, start=1):
        cell = ws_sum.cell(row=6, column=col_idx, value=h)
        cell.font = font_h1
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border
    ws_sum.row_dimensions[6].height = 24

    proj_rows = [
        ("项目/机型名称", proj_a['display_name'], proj_b['display_name']),
        ("产品名称", proj_a['name'], proj_b['name']),
        ("机型代号", proj_a['code'] or '-', proj_b['code'] or '-'),
        ("所属表单号", proj_a['form_no'], proj_b['form_no']),
        ("子系统 Sheet 数量", f"{proj_a['subsystem_count']} 个", f"{proj_b['subsystem_count']} 个"),
        ("物料种类数 (种)", f"{proj_a['material_types_count']} 种", f"{proj_b['material_types_count']} 种"),
        ("单机总装配件数 (件)", f"{proj_a['total_pieces']} 件", f"{proj_b['total_pieces']} 件")
    ]
    for r_idx, (dim, va, vb) in enumerate(proj_rows, start=7):
        ws_sum.cell(row=r_idx, column=1, value=dim).font = font_bold
        ws_sum.cell(row=r_idx, column=2, value=va).font = font_normal
        ws_sum.cell(row=r_idx, column=3, value=vb).font = font_normal
        for c in range(1, 4):
            ws_sum.cell(row=r_idx, column=c).border = thin_border
            if r_idx % 2 == 1:
                ws_sum.cell(row=r_idx, column=c).fill = zebra_fill
        ws_sum.row_dimensions[r_idx].height = 20

    # Table 2: Difference Metrics
    ws_sum['A16'] = "BOM 物料差异统计"
    ws_sum['A16'].font = font_bold
    diff_headers = ["差异分类", "物料项数 (种)", "说明"]
    for col_idx, h in enumerate(diff_headers, start=1):
        cell = ws_sum.cell(row=17, column=col_idx, value=h)
        cell.font = font_h1
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border
    ws_sum.row_dimensions[17].height = 24

    stat_rows = [
        ("🟢 目标项目新增 (+)", summary['added'], f"仅在【{proj_b['display_name']}】中存在的物料", added_fill, font_green),
        ("🔴 目标项目减少 (-)", summary['removed'], f"仅在【{proj_a['display_name']}】中存在的物料 (目标项目缺失)", removed_fill, font_red),
        ("🟡 属性/数量差异 (≠)", summary['modified'], "两项目均存在，但数量、层级、图号或分布有差异", modified_fill, font_yellow),
        ("⚪ 完全一致物料 (=)", summary['same'], "两项目在数量、层级、图号等属性上完全相同", None, font_normal),
        ("📊 总差异物料项", summary['diff_total'], "新增 + 减少 + 属性差异项之和", None, font_bold),
        ("📋 涉及物料总种类", summary['total_unique'], "两项目并集涉及的全部物料种类数", None, font_bold)
    ]
    for r_idx, (cat, cnt, desc, f_fill, f_font) in enumerate(stat_rows, start=18):
        c1 = ws_sum.cell(row=r_idx, column=1, value=cat)
        c2 = ws_sum.cell(row=r_idx, column=2, value=cnt)
        c3 = ws_sum.cell(row=r_idx, column=3, value=desc)
        c1.font = f_font or font_normal
        c2.font = f_font or font_bold
        c3.font = font_sub
        c2.alignment = Alignment(horizontal="center", vertical="center")
        for c in [c1, c2, c3]:
            c.border = thin_border
            if f_fill:
                c.fill = f_fill
        ws_sum.row_dimensions[r_idx].height = 21

    ws_sum.column_dimensions['A'].width = 24
    ws_sum.column_dimensions['B'].width = 38
    ws_sum.column_dimensions['C'].width = 45

    # ========================================================
    # Sheet 2: 差异明细清单 (Differences Only)
    # ========================================================
    ws_diff = wb.create_sheet(title="差异明细清单")
    ws_diff.views.sheetView[0].showGridLines = True

    diff_table_headers = [
        "序号", "差异状态", "物料号", "元器件名称", "规格型号", "制造商",
        f"【{proj_a['display_name']}】数量", "A单位", "A层级", "A图号", "A所属Sheet",
        f"【{proj_b['display_name']}】数量", "B单位", "B层级", "B图号", "B所属Sheet",
        "数量差额(B-A)", "具体差异说明"
    ]

    for col_idx, h in enumerate(diff_table_headers, start=1):
        cell = ws_diff.cell(row=1, column=col_idx, value=h)
        cell.font = font_h1
        cell.fill = sub_header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
    ws_diff.row_dimensions[1].height = 28

    diff_only_items = [it for it in items if it['status'] in ['added', 'removed', 'modified']]

    for row_idx, it in enumerate(diff_only_items, start=2):
        st = it['status']
        row_fill = None
        st_font = font_normal
        if st == 'added':
            row_fill = added_fill
            st_font = font_green
        elif st == 'removed':
            row_fill = removed_fill
            st_font = font_red
        elif st == 'modified':
            row_fill = modified_fill
            st_font = font_yellow

        ia = it['a'] or {}
        ib = it['b'] or {}
        changes_desc = "; ".join(c['desc'] for c in it['diff_changes']) or '-'

        row_data = [
            row_idx - 1,
            it['status_label'],
            it['material_no'],
            it['name'] or '-',
            it['spec_model'] or '-',
            it['manufacturer'] or '-',
            ia.get('total_qty_str', '-'),
            ia.get('unit', '-'),
            f"{ia.get('level_str', '')} {ia.get('level_num', '')}级" if ia.get('level_num') else '-',
            ia.get('drawing_no', '-'),
            ", ".join(ia.get('subsystems', [])) if ia.get('subsystems') else '-',
            ib.get('total_qty_str', '-'),
            ib.get('unit', '-'),
            f"{ib.get('level_str', '')} {ib.get('level_num', '')}级" if ib.get('level_num') else '-',
            ib.get('drawing_no', '-'),
            ", ".join(ib.get('subsystems', [])) if ib.get('subsystems') else '-',
            it['qty_diff_text'],
            changes_desc
        ]

        for col_idx, val in enumerate(row_data, start=1):
            cell = ws_diff.cell(row=row_idx, column=col_idx, value=val)
            cell.font = font_normal
            cell.border = thin_border
            if row_fill:
                cell.fill = row_fill

            if col_idx in [1, 2, 7, 8, 9, 10, 12, 13, 14, 15, 17]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")

            if col_idx == 2:
                cell.font = st_font
            elif col_idx == 3:
                cell.font = font_mono

        ws_diff.row_dimensions[row_idx].height = 20

    # Auto column width for ws_diff
    diff_widths = {
        1: 6, 2: 12, 3: 16, 4: 18, 5: 18, 6: 14,
        7: 14, 8: 8, 9: 10, 10: 12, 11: 14,
        12: 14, 13: 8, 14: 10, 15: 12, 16: 14,
        17: 14, 18: 36
    }
    for col_i, w in diff_widths.items():
        ws_diff.column_dimensions[get_column_letter(col_i)].width = w

    # ========================================================
    # Sheet 3: 全部物料对齐总表 (All Materials)
    # ========================================================
    ws_all = wb.create_sheet(title="全部物料对齐总表")
    ws_all.views.sheetView[0].showGridLines = True

    for col_idx, h in enumerate(diff_table_headers, start=1):
        cell = ws_all.cell(row=1, column=col_idx, value=h)
        cell.font = font_h1
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
    ws_all.row_dimensions[1].height = 28

    for row_idx, it in enumerate(items, start=2):
        st = it['status']
        row_fill = None
        st_font = font_normal
        if st == 'added':
            row_fill = added_fill
            st_font = font_green
        elif st == 'removed':
            row_fill = removed_fill
            st_font = font_red
        elif st == 'modified':
            row_fill = modified_fill
            st_font = font_yellow
        elif row_idx % 2 == 1:
            row_fill = zebra_fill

        ia = it['a'] or {}
        ib = it['b'] or {}
        changes_desc = "; ".join(c['desc'] for c in it['diff_changes']) if it['diff_changes'] else '两项目完全一致'

        row_data = [
            row_idx - 1,
            it['status_label'],
            it['material_no'],
            it['name'] or '-',
            it['spec_model'] or '-',
            it['manufacturer'] or '-',
            ia.get('total_qty_str', '-'),
            ia.get('unit', '-'),
            f"{ia.get('level_str', '')} {ia.get('level_num', '')}级" if ia.get('level_num') else '-',
            ia.get('drawing_no', '-'),
            ", ".join(ia.get('subsystems', [])) if ia.get('subsystems') else '-',
            ib.get('total_qty_str', '-'),
            ib.get('unit', '-'),
            f"{ib.get('level_str', '')} {ib.get('level_num', '')}级" if ib.get('level_num') else '-',
            ib.get('drawing_no', '-'),
            ", ".join(ib.get('subsystems', [])) if ib.get('subsystems') else '-',
            it['qty_diff_text'],
            changes_desc
        ]

        for col_idx, val in enumerate(row_data, start=1):
            cell = ws_all.cell(row=row_idx, column=col_idx, value=val)
            cell.font = font_normal
            cell.border = thin_border
            if row_fill:
                cell.fill = row_fill

            if col_idx in [1, 2, 7, 8, 9, 10, 12, 13, 14, 15, 17]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")

            if col_idx == 2:
                cell.font = st_font
            elif col_idx == 3:
                cell.font = font_mono

        ws_all.row_dimensions[row_idx].height = 20

    for col_i, w in diff_widths.items():
        ws_all.column_dimensions[get_column_letter(col_i)].width = w

    # Save to buffer
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    # Clean filename
    safe_a = (proj_a['display_name'] or '项目A').replace(' ', '_')[:25]
    safe_b = (proj_b['display_name'] or '项目B').replace(' ', '_')[:25]
    filename = f"BOM比对报告_{safe_a}_VS_{safe_b}.xlsx"

    return buf, filename


def generate_procurement_excel(res):
    """
    Generates a dedicated 'Procurement & Retrofit Increment Excel' (.xlsx) from comparison diff.
    Filters materials that are:
    1. 'added': completely new materials introduced in Target Project B
    2. 'modified' with qty_diff > 0: existing materials requiring incremental procurement
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "技改增量备件申报清单"
    ws.views.sheetView[0].showGridLines = True

    proj_a = res['project_a']
    proj_b = res['project_b']
    items = res.get('items', [])
    filter_sub = res.get('filter_subsystem', 'all')
    sub_title = "全部子系统 (整机汇总)" if filter_sub == 'all' else f"子系统: {filter_sub}"

    # Extract procurement items
    procure_items = []
    for it in items:
        st = it['status']
        q_diff = it.get('qty_diff', 0.0)
        ia = it.get('a') or {}
        ib = it.get('b') or {}

        if st == 'added':
            procure_items.append({
                'material_no': it['material_no'],
                'name': it['name'] or '-',
                'spec_model': it['spec_model'] or '-',
                'manufacturer': it['manufacturer'] or '-',
                'procure_type': '新增物料',
                'qty_a': '0',
                'qty_b': ib.get('total_qty_str', '0'),
                'inc_qty_num': q_diff,
                'inc_qty_str': format_qty_display(q_diff),
                'unit': ib.get('unit') or 'PCS',
                'drawing_no': ib.get('drawing_no') or '/',
                'subsystems': ", ".join(ib.get('subsystems', [])) if ib.get('subsystems') else '-',
                'substitute': ib.get('substitute') or '-',
                'notes': "; ".join(c['desc'] for c in it.get('diff_changes', [])) or '新引入备件需求'
            })
        elif st == 'modified' and q_diff > 0:
            procure_items.append({
                'material_no': it['material_no'],
                'name': it['name'] or '-',
                'spec_model': it['spec_model'] or '-',
                'manufacturer': it['manufacturer'] or '-',
                'procure_type': '增量补齐',
                'qty_a': ia.get('total_qty_str', '0'),
                'qty_b': ib.get('total_qty_str', '0'),
                'inc_qty_num': q_diff,
                'inc_qty_str': format_qty_display(q_diff),
                'unit': ib.get('unit') or ia.get('unit') or 'PCS',
                'drawing_no': ib.get('drawing_no') or ia.get('drawing_no') or '/',
                'subsystems': ", ".join(ib.get('subsystems', [])) if ib.get('subsystems') else ia.get('subsystems', '-'),
                'substitute': ib.get('substitute') or ia.get('substitute') or '-',
                'notes': "; ".join(c['desc'] for c in it.get('diff_changes', [])) or '单机定额增加'
            })

    # Styling
    font_title = Font(name="微软雅黑", size=15, bold=True, color="1E3A8A")
    font_sub = Font(name="微软雅黑", size=10, color="475569")
    font_kpi_label = Font(name="微软雅黑", size=10, color="64748b")
    font_kpi_val = Font(name="微软雅黑", size=12, bold=True, color="0F766E")
    font_h1 = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
    font_normal = Font(name="微软雅黑", size=10)
    font_bold = Font(name="微软雅黑", size=10, bold=True)
    font_mono = Font(name="Consolas", size=10, bold=True)
    font_mono_regular = Font(name="Consolas", size=10)

    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    kpi_fill = PatternFill(start_color="F0FDFA", end_color="F0FDFA", fill_type="solid")
    added_type_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
    topup_type_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
    zebra_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    # Title & Metadata
    ws['A1'] = "风电机组技改 / 增量备件采购申报清单"
    ws['A1'].font = font_title
    ws.merge_cells("A1:N1")
    ws.row_dimensions[1].height = 32

    export_time = time.strftime('%Y-%m-%d %H:%M:%S')
    ws['A2'] = f"基准机型: {proj_a['display_name']} ({proj_a['code']})   ->   目标技改机型: {proj_b['display_name']} ({proj_b['code']})   |   比对范围: {sub_title}   |   导出时间: {export_time}"
    ws['A2'].font = font_sub
    ws.merge_cells("A2:N2")
    ws.row_dimensions[2].height = 20

    # Summary KPI banner
    new_count = len([x for x in procure_items if x['procure_type'] == '新增物料'])
    topup_count = len([x for x in procure_items if x['procure_type'] == '增量补齐'])
    total_qty_sum = sum(x['inc_qty_num'] for x in procure_items)

    ws['A3'] = "申报物料种类总计:"
    ws['B3'] = f"{len(procure_items)} 种 (目标新增: {new_count} 种，增量补齐: {topup_count} 种)"
    ws['E3'] = "累计增量采购件数:"
    ws['F3'] = f"{format_qty_display(total_qty_sum)} 件"

    for r_k in [3]:
        ws.row_dimensions[r_k].height = 22
        for col_k in range(1, 15):
            c = ws.cell(row=r_k, column=col_k)
            c.fill = kpi_fill
            c.border = thin_border

    ws['A3'].font = font_kpi_label
    ws['B3'].font = font_kpi_val
    ws['E3'].font = font_kpi_label
    ws['F3'].font = font_kpi_val

    # Table Header
    headers = [
        "序号", "申报类别", "物料编码", "元器件名称", "规格型号", "制造厂商",
        f"基准用量(A)", f"目标用量(B)", "本次申报增量", "计量单位", "图纸/代号",
        "所属子系统/总成", "推荐替代料", "采购申报依据 / 变更说明"
    ]
    header_row = 5
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=header_row, column=col_idx, value=h)
        cell.font = font_h1
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
    ws.row_dimensions[header_row].height = 28

    # Table Data
    if not procure_items:
        ws.cell(row=6, column=1, value="✅ 比对结果显示：两项目完全一致或目标项目无新增/增量采购需求，无需申报采购备件。")
        ws.merge_cells("A6:N6")
        ws.cell(row=6, column=1).alignment = Alignment(horizontal="center", vertical="center")
        ws.cell(row=6, column=1).font = font_normal
        ws.row_dimensions[6].height = 36
    else:
        for row_idx, it in enumerate(procure_items, start=6):
            row_data = [
                row_idx - 5,
                it['procure_type'],
                it['material_no'],
                it['name'],
                it['spec_model'],
                it['manufacturer'],
                it['qty_a'],
                it['qty_b'],
                it['inc_qty_str'],
                it['unit'],
                it['drawing_no'],
                it['subsystems'],
                it['substitute'],
                it['notes']
            ]

            is_zebra = (row_idx % 2 == 1)
            row_fill = zebra_fill if is_zebra else None

            for col_idx, val in enumerate(row_data, start=1):
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                cell.font = font_normal
                cell.border = thin_border
                if row_fill:
                    cell.fill = row_fill

                # Alignments & Styles
                if col_idx in [1, 2, 7, 8, 9, 10, 11]:
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                else:
                    cell.alignment = Alignment(horizontal="left", vertical="center")

                if col_idx == 2:
                    if it['procure_type'] == '新增物料':
                        cell.fill = added_type_fill
                        cell.font = Font(name="微软雅黑", size=10, bold=True, color="166534")
                    else:
                        cell.fill = topup_type_fill
                        cell.font = Font(name="微软雅黑", size=10, bold=True, color="92400E")
                elif col_idx == 3:
                    cell.font = font_mono
                elif col_idx in [7, 8]:
                    cell.font = font_mono_regular
                elif col_idx == 9:
                    cell.font = Font(name="Consolas", size=11, bold=True, color="0F766E")

            ws.row_dimensions[row_idx].height = 22

    # Column Widths
    col_widths = {
        1: 6, 2: 12, 3: 16, 4: 20, 5: 22, 6: 16,
        7: 14, 8: 14, 9: 14, 10: 9, 11: 14,
        12: 18, 13: 14, 14: 38
    }
    for col_i, w in col_widths.items():
        ws.column_dimensions[get_column_letter(col_i)].width = w

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    safe_a = (proj_a['display_name'] or '项目A').replace(' ', '_')[:25]
    safe_b = (proj_b['display_name'] or '项目B').replace(' ', '_')[:25]
    filename = f"技改增量备件采购申报清单_{safe_a}_TO_{safe_b}.xlsx"

    return buf, filename


def generate_ecn_change_description(res):
    """
    Generates intelligent engineering ECN (Engineering Change Notice) description and changelog
    based on BOM comparison diff results.
    Returns both Markdown format and plain text summary.
    """
    proj_a = res['project_a']
    proj_b = res['project_b']
    items = res.get('items', [])
    summary = res.get('summary', {})
    filter_sub = res.get('filter_subsystem', 'all')
    sub_title = "全部子系统 (整机汇总)" if filter_sub == 'all' else f"子系统: {filter_sub}"
    export_time = time.strftime('%Y-%m-%d %H:%M:%S')

    added_items = [it for it in items if it['status'] == 'added']
    removed_items = [it for it in items if it['status'] == 'removed']
    modified_items = [it for it in items if it['status'] == 'modified']
    same_items = [it for it in items if it['status'] == 'same']

    # Total procurement demand
    procure_items = [it for it in items if it['status'] == 'added' or (it['status'] == 'modified' and it.get('qty_diff', 0.0) > 0)]
    procure_total_qty = sum(it.get('qty_diff', 0.0) for it in procure_items)

    added_qty_sum = sum(it.get('qty_diff', 0.0) for it in added_items)
    removed_qty_sum = sum(abs(it.get('qty_diff', 0.0)) for it in removed_items)

    proj_a_title = f"{proj_a.get('display_name', '')} (代号: {proj_a.get('code', '-')})"
    proj_b_title = f"{proj_b.get('display_name', '')} (代号: {proj_b.get('code', '-')})"

    # 1. Build Markdown
    md_lines = [
        f"# 工程变更通知单 (ECN) 变更履历提报草稿",
        f"",
        f"> **生成时间**: {export_time} &nbsp;|&nbsp; **编制系统**: 上海电气风电集团 Service BOM 数字化系统",
        f"",
        f"---",
        f"",
        f"## 一、变更基本信息与比对范围",
        f"- **基准机型/工程 (A)**: {proj_a_title}",
        f"- **变更目标机型/工程 (B)**: {proj_b_title}",
        f"- **涉及子系统范围**: {sub_title}",
        f"- **整体变更统计指标**:",
        f"  - 🟢 **新增导入零部件**: **{len(added_items)}** 种 (累计单机装配需求 **{format_qty_display(added_qty_sum)}** 件)",
        f"  - 🔴 **停用/淘汰零部件**: **{len(removed_items)}** 种 (原单机配额 **{format_qty_display(removed_qty_sum)}** 件)",
        f"  - 🟡 **参数/规格/定额调整零部件**: **{len(modified_items)}** 种",
        f"  - ⚪ **完全保持一致零部件**: **{len(same_items)}** 种",
        f"  - 📦 **技改增量备件申报需求**: 共涉及 **{len(procure_items)}** 种物料需向供应链发起增量采购申报，累计增量需求 **{format_qty_display(procure_total_qty)}** 件",
        f""
    ]

    # Added Section
    md_lines.append(f"## 二、新增零部件导入清单 (Added Parts)")
    if not added_items:
        md_lines.append(f"_目标项目无新增物料导入。_\n")
    else:
        md_lines.append(f"| 序号 | 物料编码 | 元器件名称 | 规格型号 | 制造厂商 | 单机用量 | 单位 | 所属子系统 | 图号/代号 |")
        md_lines.append(f"|:---:|:---|:---|:---|:---|:---:|:---:|:---|:---|")
        for idx, it in enumerate(added_items, start=1):
            ib = it.get('b') or {}
            subs = ", ".join(ib.get('subsystems', [])) if ib.get('subsystems') else '-'
            md_lines.append(
                f"| {idx} | `{it['material_no']}` | {it['name'] or '-'} | {it['spec_model'] or '-'} | "
                f"{it['manufacturer'] or '-'} | **{ib.get('total_qty_str', '1')}** | {ib.get('unit', 'PCS')} | {subs} | {ib.get('drawing_no') or '/'} |"
            )
        md_lines.append("")

    # Removed Section
    md_lines.append(f"## 三、淘汰/停用零部件清单 (Discontinued Parts)")
    if not removed_items:
        md_lines.append(f"_目标项目无淘汰或移除物料。_\n")
    else:
        md_lines.append(f"| 序号 | 物料编码 | 元器件名称 | 规格型号 | 制造厂商 | 原单机用量 | 单位 | 原所属子系统 | 图号/代号 |")
        md_lines.append(f"|:---:|:---|:---|:---|:---|:---:|:---:|:---|:---|")
        for idx, it in enumerate(removed_items, start=1):
            ia = it.get('a') or {}
            subs = ", ".join(ia.get('subsystems', [])) if ia.get('subsystems') else '-'
            md_lines.append(
                f"| {idx} | `{it['material_no']}` | {it['name'] or '-'} | {it['spec_model'] or '-'} | "
                f"{it['manufacturer'] or '-'} | **{ia.get('total_qty_str', '1')}** | {ia.get('unit', 'PCS')} | {subs} | {ia.get('drawing_no') or '/'} |"
            )
        md_lines.append("")

    # Modified Section
    md_lines.append(f"## 四、规格参数与单机配额调整明细 (Modified Specifications & Quantities)")
    if not modified_items:
        md_lines.append(f"_目标项目与基准项目无参数、数量或层级变动。_\n")
    else:
        md_lines.append(f"| 序号 | 物料编码 | 元器件名称 | 规格型号 | 基准项目 (A) | 目标项目 (B) | 数量差额 | 变更详情与工程说明 |")
        md_lines.append(f"|:---:|:---|:---|:---|:---:|:---:|:---:|:---|")
        for idx, it in enumerate(modified_items, start=1):
            ia = it.get('a') or {}
            ib = it.get('b') or {}
            diff_text = "; ".join(c['desc'] for c in it.get('diff_changes', [])) or '-'
            a_desc = f"{ia.get('total_qty_str', '0')} {ia.get('unit', '')}"
            b_desc = f"{ib.get('total_qty_str', '0')} {ib.get('unit', '')}"
            md_lines.append(
                f"| {idx} | `{it['material_no']}` | {it['name'] or '-'} | {it['spec_model'] or '-'} | "
                f"{a_desc} | {b_desc} | `{it.get('qty_diff_text', '0')}` | {diff_text} |"
            )
        md_lines.append("")

    # Procurement & Field Recommendations
    md_lines.append(f"## 五、技改实施与供应链采购建议")
    md_lines.append(f"1. **增量备件申报采购**：本次技改升级共计涉及 **{len(procure_items)}** 种物料需发起供应链采购或仓储调拨（净增采购总量 **{format_qty_display(procure_total_qty)}** 件），请使用配套导出的《技改增量备件采购申报清单.xlsx》跟进审批流程。")
    md_lines.append(f"2. **淘汰停用备件处置**：对上述 **{len(removed_items)}** 种停用零部件，应核对项目现场在途及库存备件，优先评估是否具备替代兼容性，避免呆滞积压或资材浪费。")
    md_lines.append(f"3. **现场技术资料核验**：针对新引入的 **{len(added_items)}** 种零部件，请确保已在系统中关联实物高清图与厂家技术手册（PDF），并重新导出《整机备件技术资料离线包.zip》分发至风场运维班组。")
    md_lines.append(f"")
    md_lines.append(f"---")
    md_lines.append(f"*注：本 ECN 变更履历由系统 BOM 智能比对引擎自动萃取，经工程师复核签字后即可作为正式技术改造工程归档附件。*")

    md_text = "\n".join(md_lines)

    # 2. Build concise plain text for clipboard / ERP copy
    plain_lines = [
        f"【ECN 变更内容描述】",
        f"基准工程: {proj_a_title} -> 目标工程: {proj_b_title} (范围: {sub_title})",
        f"变更概况: 新增物料 {len(added_items)} 种 (+{format_qty_display(added_qty_sum)}件)；淘汰停用物料 {len(removed_items)} 种 (-{format_qty_display(removed_qty_sum)}件)；规格/用量调整物料 {len(modified_items)} 种；增量采购申报需求 {len(procure_items)} 种 ({format_qty_display(procure_total_qty)}件)。",
        f"",
        f"1. 新增导入零部件:",
    ]
    if added_items:
        for it in added_items:
            ib = it.get('b') or {}
            plain_lines.append(f"  + [{it['material_no']}] {it['name']} ({it['spec_model']}) 用量: {ib.get('total_qty_str', '1')}{ib.get('unit', '')}")
    else:
        plain_lines.append("  (无新增物料)")

    plain_lines.append("\n2. 淘汰/停用零部件:")
    if removed_items:
        for it in removed_items:
            ia = it.get('a') or {}
            plain_lines.append(f"  - [{it['material_no']}] {it['name']} ({it['spec_model']}) 原用量: {ia.get('total_qty_str', '1')}{ia.get('unit', '')}")
    else:
        plain_lines.append("  (无淘汰物料)")

    plain_lines.append("\n3. 规格/数量调整零部件:")
    if modified_items:
        for it in modified_items:
            changes_str = "; ".join(c['desc'] for c in it.get('diff_changes', []))
            plain_lines.append(f"  * [{it['material_no']}] {it['name']}: {changes_str}")
    else:
        plain_lines.append("  (无调整物料)")

    plain_text = "\n".join(plain_lines)

    return {
        'success': True,
        'ecn_markdown': md_text,
        'ecn_text': plain_text,
        'summary': {
            'added_count': len(added_items),
            'added_qty': format_qty_display(added_qty_sum),
            'removed_count': len(removed_items),
            'removed_qty': format_qty_display(removed_qty_sum),
            'modified_count': len(modified_items),
            'same_count': len(same_items),
            'procure_count': len(procure_items),
            'procure_total_qty': format_qty_display(procure_total_qty),
            'proj_a_name': proj_a.get('display_name', ''),
            'proj_b_name': proj_b.get('display_name', ''),
            'proj_b_id': proj_b.get('id')
        }
    }

