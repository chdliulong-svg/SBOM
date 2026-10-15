# offline_packager.py
"""
Service BOM - Offline Field Package Generator
Packs all project technical deliverables into an offline-ready ZIP archive:
1. 1_标准清单_SBOM/SBOM_{code}_{name}.xlsx
2. 2_实物照片_Photos/{mat_no}_{name}.png
3. 3_技术手册_Manuals/{mat_no}_{name}.pdf
4. 4_现场离线速查_Offline_Index.html (Stand-alone searchable HTML index)
5. README_现场使用说明.txt
"""

import os
import io
import json
import zipfile
import tempfile
import re
from datetime import datetime
from .database import get_db
from .exporter import export_project_sbom

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def sanitize_filename(name):
    if not name:
        return 'unnamed'
    return re.sub(r'[\\/*?:"<>|]', '_', str(name)).strip()

def build_offline_html(project_info, materials_summary, items_list):
    """
    Generates a standalone single-file HTML viewer with embedded JSON data,
    allowing technicians to search parts, view photos and open manuals offline.
    """
    json_data = json.dumps(items_list, ensure_ascii=False)
    proj_title = project_info.get('system_name') or project_info.get('name') or project_info.get('code') or '风电机组 Service BOM'
    proj_code = project_info.get('code') or '-'
    doc_no = project_info.get('doc_no') or '-'
    export_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>【离线速查】{proj_title} - 风电机组备件服务手册</title>
    <style>
        :root {{
            --primary: #0284c7;
            --primary-dark: #0369a1;
            --bg: #f8fafc;
            --border: #e2e8f0;
            --text: #0f172a;
            --text-muted: #64748b;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
            background: var(--bg);
            color: var(--text);
            padding: 16px 20px;
        }}
        .header {{
            background: #ffffff;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 16px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }}
        .header-top {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 12px;
            margin-bottom: 12px;
        }}
        .title {{
            font-size: 20px;
            font-weight: 700;
            color: #1e293b;
        }}
        .badge-offline {{
            background: #dcfce7;
            color: #15803d;
            border: 1px solid #86efac;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }}
        .meta-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 10px;
            font-size: 13px;
            color: var(--text-muted);
        }}
        .meta-item b {{ color: var(--text); }}
        .toolbar {{
            background: #ffffff;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
        }}
        .search-box {{
            flex: 1;
            min-width: 260px;
            max-width: 480px;
            position: relative;
        }}
        .search-box input {{
            width: 100%;
            padding: 8px 12px;
            font-size: 13px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            outline: none;
        }}
        .search-box input:focus {{
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(2,132,199,0.15);
        }}
        .stat-text {{
            font-size: 13px;
            color: var(--text-muted);
        }}
        .table-wrap {{
            background: #ffffff;
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow-x: auto;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            text-align: left;
        }}
        th {{
            background: #f1f5f9;
            color: #475569;
            font-weight: 600;
            padding: 9px 10px;
            border-bottom: 2px solid var(--border);
            white-space: nowrap;
        }}
        td {{
            padding: 8px 10px;
            border-bottom: 1px solid #f1f5f9;
            color: #334155;
        }}
        tr:hover td {{
            background: #f8fafc;
        }}
        .mat-no {{
            font-family: monospace;
            font-weight: 700;
            color: #1e40af;
        }}
        .spec {{
            font-family: monospace;
            color: #0369a1;
            max-width: 170px;
            word-break: break-all;
            line-height: 1.35;
        }}
        .desc-text {{
            color: #475569;
            min-width: 280px;
            white-space: normal;
            word-break: break-word;
            line-height: 1.4;
            font-size: 12px;
        }}
        .btn-link {{
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 2px 7px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            text-decoration: none;
            cursor: pointer;
        }}
        .btn-photo {{
            background: #e0f2fe;
            color: #0369a1;
            border: 1px solid #bae6fd;
        }}
        .btn-photo:hover {{ background: #bae6fd; }}
        .btn-manual {{
            background: #fee2e2;
            color: #b91c1c;
            border: 1px solid #fecaca;
        }}
        .btn-manual:hover {{ background: #fecaca; }}
        .lvl-badge {{
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
        }}
        .lvl-1 {{ background: #eff6ff; color: #1d4ed8; }}
        .lvl-2 {{ background: #f1f5f9; color: #475569; }}
        .lvl-3 {{ background: #fafaf9; color: #78716c; }}
        /* Image Preview Modal */
        #imgModal {{
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.75);
            z-index: 9999;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        #imgModal img {{
            max-width: 90vw;
            max-height: 85vh;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            background: #fff;
        }}
    </style>
</head>
<body>
    <div class="header">
        <div class="header-top">
            <div style="display: flex; align-items: center; gap: 10px;">
                <h1 class="title">{proj_title}</h1>
                <span class="badge-offline">⚡ 现场全离线可用</span>
            </div>
            <div>
                <a href="1_标准清单_SBOM/" style="color: #0284c7; font-size: 13px; text-decoration: none; font-weight: 600;">📊 打开标准 SBOM Excel 文件夹</a>
            </div>
        </div>
        <div class="meta-grid">
            <div class="meta-item">机型代码: <b>{proj_code}</b></div>
            <div class="meta-item">文件编号: <b>{doc_no}</b></div>
            <div class="meta-item">零部件行数: <b>{len(items_list)}</b> 行</div>
            <div class="meta-item">导出归档时间: <b>{export_time}</b></div>
        </div>
    </div>

    <div class="toolbar">
        <div class="search-box">
            <input type="text" id="searchInput" placeholder="搜索物料号 / 元器件名称 / 物料描述 / 规格型号 / 制造商 / 子系统..." oninput="doSearch()">
        </div>
        <div class="stat-text" id="statText">共 {len(items_list)} 项备件</div>
    </div>

    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th style="width: 36px; text-align: center;">#</th>
                    <th style="width: 95px;">所属子系统</th>
                    <th style="width: 55px; text-align: center;">层级</th>
                    <th style="width: 110px;">物料号</th>
                    <th style="width: 130px;">元器件名称</th>
                    <th style="min-width: 320px;">物料描述</th>
                    <th style="width: 160px;">规格型号</th>
                    <th style="width: 95px;">制造商</th>
                    <th style="width: 85px;">图纸代号</th>
                    <th style="width: 50px; text-align: center;">数量</th>
                    <th style="width: 45px; text-align: center;">单位</th>
                    <th style="width: 125px; text-align: center;">实物照片 / 手册</th>
                    <th style="width: 115px;">技术备注</th>
                </tr>
            </thead>
            <tbody id="tableBody">
                <!-- Injected via JS -->
            </tbody>
        </table>
    </div>

    <div id="imgModal" onclick="closeImgModal()">
        <img id="imgModalTag" src="" alt="实物照片预览">
    </div>

    <script>
        const allItems = {json_data};

        function escapeHtml(str) {{
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }}

        function formatPipeMultilineHtml(val) {{
            if (!val) return '';
            const rawStr = String(val).trim();
            if (!/[|｜\n]/.test(rawStr)) return escapeHtml(rawStr);
            const lines = rawStr.split(/[|｜\n]/).map(s => s.trim()).filter(s => s.length > 0);
            if (lines.length <= 1) return escapeHtml(lines[0] || rawStr);
            return '<div style="display:flex; flex-direction:column; gap:2px;">' +
                lines.map(l => `<span style="line-height:1.35;">${{escapeHtml(l)}}</span>`).join('') +
                '</div>';
        }}

        function renderTable(list) {{
            const tbody = document.getElementById('tableBody');
            const statText = document.getElementById('statText');
            statText.textContent = `当前显示 ${{list.length}} 项 (共 ${{allItems.length}} 项)`;

            if (list.length === 0) {{
                tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: #94a3b8; padding: 40px;">未找到匹配备件</td></tr>';
                return;
            }}

            let html = '';
            list.forEach((it, idx) => {{
                let photoBtn = '<span style="color: #cbd5e1;">-</span>';
                if (it.photo_rel) {{
                    photoBtn = `<a href="javascript:void(0)" onclick="openImgModal('${{it.photo_rel}}')" class="btn-link btn-photo">🖼️ 照片</a>`;
                }}

                let manualBtn = '';
                if (it.manual_rel) {{
                    manualBtn = `<a href="${{it.manual_rel}}" target="_blank" class="btn-link btn-manual">📄 手册</a>`;
                }}

                const attachHtml = `<div style="display: flex; gap: 4px; justify-content: center;">${{photoBtn}} ${{manualBtn}}</div>`;

                const lvl = parseInt(it.level_num) || 2;
                const lvlClass = lvl === 1 ? 'lvl-1' : (lvl === 2 ? 'lvl-2' : 'lvl-3');
                const lvlLabel = lvl === 1 ? '一级' : (lvl === 2 ? '二级' : `${{lvl}}级`);

                html += `
                    <tr>
                        <td style="text-align: center; color: #94a3b8;">${{idx + 1}}</td>
                        <td style="font-weight: 500; color: #1e293b;">${{escapeHtml(it.subsystem_name || '-')}}</td>
                        <td style="text-align: center;"><span class="lvl-badge ${{lvlClass}}">${{lvlLabel}}</span></td>
                        <td class="mat-no">${{formatPipeMultilineHtml(it.material_no || '-')}}</td>
                        <td style="font-weight: 600;">${{formatPipeMultilineHtml(it.m_name || '-')}}</td>
                        <td class="desc-text" title="${{escapeHtml(it.m_desc || '')}}">${{formatPipeMultilineHtml(it.m_desc || '-')}}</td>
                        <td class="spec">${{formatPipeMultilineHtml(it.m_model || '-')}}</td>
                        <td>${{formatPipeMultilineHtml(it.m_mfr || '-')}}</td>
                        <td style="color: #64748b;">${{formatPipeMultilineHtml(it.drawing_no || '/')}}</td>
                        <td style="text-align: center; font-weight: 600;">${{escapeHtml(it.qty || '1')}}</td>
                        <td style="text-align: center; color: #64748b;">${{escapeHtml(it.unit || 'PC')}}</td>
                        <td>${{attachHtml}}</td>
                        <td style="color: #64748b; font-size: 11px;">${{formatPipeMultilineHtml(it.notes || '')}}</td>
                    </tr>`;
            }});
            tbody.innerHTML = html;
        }}

        function doSearch() {{
            const q = document.getElementById('searchInput').value.trim().toLowerCase();
            if (!q) {{
                renderTable(allItems);
                return;
            }}
            const terms = q.split(/\\s+/);
            const filtered = allItems.filter(it => {{
                const str = `${{it.subsystem_name}} ${{it.material_no}} ${{it.m_name}} ${{it.m_desc}} ${{it.m_model}} ${{it.m_mfr}} ${{it.drawing_no}} ${{it.notes}}`.toLowerCase();
                return terms.every(t => str.includes(t));
            }});
            renderTable(filtered);
        }}

        function openImgModal(src) {{
            document.getElementById('imgModalTag').src = src;
            document.getElementById('imgModal').style.display = 'flex';
        }}
        function closeImgModal() {{
            document.getElementById('imgModal').style.display = 'none';
        }}

        // Initial render
        renderTable(allItems);
    </script>
</body>
</html>"""
    return html

def generate_offline_package(project_id):
    """
    Creates an offline field package ZIP archive and returns (BytesIO, filename).
    """
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    proj_row = cursor.fetchone()
    if not proj_row:
        conn.close()
        raise ValueError(f"项目 ID {project_id} 不存在")

    project_info = dict(proj_row)
    proj_name = project_info.get('system_name') or project_info.get('name') or project_info.get('code') or f'项目_{project_id}'
    proj_code = project_info.get('code') or 'FD'
    safe_name = sanitize_filename(proj_name)
    safe_code = sanitize_filename(proj_code)

    # Fetch BOM items with material details and subsystems
    cursor.execute('''
    SELECT b.id, b.row_num, b.level_str, b.level_num, b.seq_num, b.material_no,
           b.drawing_no, b.qty, b.unit, b.notes, b.substitute,
           s.name as subsystem_name, s.sort_order as sub_sort,
           m.name as m_name, m.spec_model as m_model, m.manufacturer as m_mfr,
           m.description as m_desc, m.image_path, m.manual_path
    FROM bom_items b
    JOIN subsystems s ON b.subsystem_id = s.id
    LEFT JOIN materials m ON b.material_no = m.material_no
    WHERE s.project_id = ?
    ORDER BY s.sort_order, s.id, b.row_num, b.id
    ''', (project_id,))
    raw_items = [dict(r) for r in cursor.fetchall()]
    conn.close()

    # Create temporary directory for building standard Excel
    temp_dir = tempfile.mkdtemp()
    excel_filename = f"SBOM_{safe_code}_{safe_name}.xlsx"
    excel_path = os.path.join(temp_dir, excel_filename)

    try:
        export_project_sbom(project_id, excel_path)
    except Exception as e:
        print("Warning exporting SBOM for offline package:", e)

    # Process attachments
    materials_photo_map = {}
    materials_manual_map = {}
    copied_photos = set()
    copied_manuals = set()

    for it in raw_items:
        mat_no = (it.get('material_no') or '').strip()
        img_p = (it.get('image_path') or '').strip()
        man_p = (it.get('manual_path') or '').strip()

        if mat_no and img_p:
            clean_img = img_p.replace('/', os.sep).replace('\\', os.sep)
            if not os.path.isabs(clean_img):
                clean_img = os.path.join(BASE_DIR, clean_img)
            if os.path.exists(clean_img):
                ext = os.path.splitext(clean_img)[1].lower()
                clean_mat = sanitize_filename(mat_no)
                clean_mname = sanitize_filename(it.get('m_name') or '')
                target_fname = f"{clean_mat}_{clean_mname}{ext}" if clean_mname else f"{clean_mat}{ext}"
                materials_photo_map[mat_no] = (clean_img, target_fname)

        if mat_no and man_p:
            clean_man = man_p.replace('/', os.sep).replace('\\', os.sep)
            if not os.path.isabs(clean_man):
                clean_man = os.path.join(BASE_DIR, clean_man)
            if os.path.exists(clean_man):
                clean_mat = sanitize_filename(mat_no)
                clean_mname = sanitize_filename(it.get('m_name') or '')
                target_fname = f"{clean_mat}_{clean_mname}.pdf" if clean_mname else f"{clean_mat}.pdf"
                materials_manual_map[mat_no] = (clean_man, target_fname)

    # Build items list for HTML viewer
    html_items = []
    for it in raw_items:
        mat_no = (it.get('material_no') or '').strip()
        photo_rel = ""
        manual_rel = ""
        if mat_no in materials_photo_map:
            photo_rel = f"2_实物照片_Photos/{materials_photo_map[mat_no][1]}"
        if mat_no in materials_manual_map:
            manual_rel = f"3_技术手册_Manuals/{materials_manual_map[mat_no][1]}"

        html_items.append({
            'subsystem_name': it.get('subsystem_name') or '',
            'level_num': it.get('level_num') or 2,
            'row_num': it.get('row_num') or '',
            'material_no': mat_no,
            'm_name': it.get('m_name') or '',
            'm_desc': it.get('m_desc') or '',
            'm_model': it.get('m_model') or '',
            'm_mfr': it.get('m_mfr') or '',
            'drawing_no': it.get('drawing_no') or '/',
            'qty': it.get('qty') or '1',
            'unit': it.get('unit') or 'PC',
            'notes': it.get('notes') or '',
            'photo_rel': photo_rel,
            'manual_rel': manual_rel
        })

    offline_html = build_offline_html(project_info, {}, html_items)

    # Build README text
    timestamp_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    readme_text = f"""========================================================================
风电机组备件 Service BOM 现场离线运维工程资料包
========================================================================

【机组项目信息】
• 工程名称: {proj_name}
• 机组型号代码: {proj_code}
• 图纸/文件代号: {project_info.get('doc_no') or '-'}
• 归档导出时间: {timestamp_str}
• BOM 零部件总行数: {len(raw_items)} 行
• 包含实物照片: {len(materials_photo_map)} 张
• 包含技术手册 (PDF): {len(materials_manual_map)} 份

【目录结构说明】
• 现场离线备件速查.html
  - 纯前端自包含免安装速查界面，在风电运维现场（无网络、无服务器环境下）
    可直接双击使用 Edge、Chrome、三防平板浏览器打开。
  - 支持按物料号、型号、名称、物料描述、子系统毫秒级关键字检索，支持直接查阅实物图与手册。

• 1_标准清单_SBOM/
  - 存放标准规范的工程 SBOM.xlsx 文件，支持直接在 Excel / WPS 中查阅或修改。

• 2_实物照片_Photos/
  - 存放该机组所引用备件的全部实物高清照片（按 物料号_名称 命名）。

• 3_技术手册_Manuals/
  - 存放该机组所引用零部件的技术手册 PDF 文件。

========================================================================
上海电气风电集团股份有限公司 · 数字化服务工程系统
========================================================================
"""

    # Assemble ZIP directly to disk file (零内存开销，彻底防止局域网并发导出时 OOM 崩溃)
    out_dir = os.path.join(BASE_DIR, 'exports')
    os.makedirs(out_dir, exist_ok=True)
    zip_filename = f"SBOM_离线运维资料包_{safe_code}_{safe_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    zip_path = os.path.join(out_dir, zip_filename)

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 1. Excel SBOM
        if os.path.exists(excel_path):
            zf.write(excel_path, f"1_标准清单_SBOM/{excel_filename}")

        # 2. Photos
        for mat_no, (src_file, target_fname) in materials_photo_map.items():
            zf.write(src_file, f"2_实物照片_Photos/{target_fname}")

        # 3. Manuals
        for mat_no, (src_file, target_fname) in materials_manual_map.items():
            zf.write(src_file, f"3_技术手册_Manuals/{target_fname}")

        # 4. Offline HTML Index
        zf.writestr("现场离线备件速查.html", offline_html.encode('utf-8'))

        # 5. README.txt
        zf.writestr("README_现场使用说明.txt", readme_text.encode('utf-8'))

    # Clean up temp
    try:
        if os.path.exists(excel_path):
            os.remove(excel_path)
        os.rmdir(temp_dir)
    except:
        pass

    return zip_path, zip_filename

