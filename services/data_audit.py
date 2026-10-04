# data_audit.py
"""
Service BOM - Material Master De-duplication Engine
Focuses purely on intelligent de-duplication (一物多码排查):
- Identifies duplicate groups by normalized specification and name
- Tracks project references for each candidate material
- Enables one-click cleanup/deletion of redundant orphan duplicates
- Real-time input duplicate check during material creation/editing
"""

import re
import difflib
from .database import get_db

def normalize_text(text):
    if not text:
        return ''
    return re.sub(r'[\s\-_/\\()（）·,，。\[\]【】:：;；"\'“”‘’]', '', str(text).lower())

def get_duplicate_materials_report():
    """
    Returns grouped list of duplicate materials across the master library.
    Each group lists all duplicate candidate materials, their details,
    and their project reference status.
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    SELECT m.material_no, m.name, m.spec_model, m.manufacturer, m.drawing_no, m.unit, m.image_path, m.manual_path
    FROM materials m
    ORDER BY m.material_no
    ''')
    materials = [dict(r) for r in cursor.fetchall()]

    # Map each material to its project references
    material_refs = {}
    for m in materials:
        mat_no = m['material_no']
        cursor.execute('''
        SELECT COUNT(DISTINCT p.id), GROUP_CONCAT(DISTINCT COALESCE(NULLIF(p.code, ''), p.name))
        FROM bom_items b
        JOIN subsystems sub ON b.subsystem_id = sub.id
        JOIN projects p ON sub.project_id = p.id
        WHERE b.material_no = ?
        ''', (mat_no,))
        row = cursor.fetchone()
        ref_count = row[0] or 0
        ref_projects = row[1] or ''

        # Also check if it's referenced in material_structures (parent or child)
        cursor.execute('''
        SELECT COUNT(*) FROM material_structures
        WHERE parent_material_no = ? OR child_material_no = ?
        ''', (mat_no, mat_no))
        struct_refs = cursor.fetchone()[0] or 0

        m['ref_count'] = ref_count
        m['ref_projects'] = ref_projects
        m['struct_refs'] = struct_refs
        m['is_in_use'] = (ref_count > 0 or struct_refs > 0)
        material_refs[mat_no] = m

    conn.close()

    # Group materials by normalized specification or (name + spec)
    from collections import defaultdict
    spec_groups = defaultdict(list)
    comb_groups = defaultdict(list)

    for m in materials:
        s_norm = normalize_text(m['spec_model'])
        n_norm = normalize_text(m['name'])

        if s_norm and len(s_norm) >= 3:
            spec_groups[s_norm].append(m)
        elif (n_norm + s_norm) and len(n_norm + s_norm) >= 4:
            comb_groups[n_norm + s_norm].append(m)

    groups = []
    seen_mat_nos = set()

    # Rule 1: Same normalized spec model
    for s_norm, items in spec_groups.items():
        if len(items) > 1:
            mat_nos = tuple(sorted([x['material_no'] for x in items]))
            if mat_nos not in seen_mat_nos:
                seen_mat_nos.add(mat_nos)
                groups.append({
                    'group_key': f"spec_{s_norm}",
                    'spec_title': items[0]['spec_model'] or s_norm,
                    'name_title': items[0]['name'] or '',
                    'reason': f"型号规格完全一致（{items[0]['spec_model']}），但分配了 {len(items)} 个不同物料编码",
                    'items_count': len(items),
                    'items': items
                })

    # Rule 2: Same normalized (name + spec)
    for c_norm, items in comb_groups.items():
        if len(items) > 1:
            mat_nos = tuple(sorted([x['material_no'] for x in items]))
            if mat_nos not in seen_mat_nos:
                seen_mat_nos.add(mat_nos)
                groups.append({
                    'group_key': f"comb_{c_norm}",
                    'spec_title': items[0]['spec_model'] or '',
                    'name_title': items[0]['name'] or '',
                    'reason': f"名称与型号组合后完全一致，但分配了 {len(items)} 个不同物料编码",
                    'items_count': len(items),
                    'items': items
                })

    total_duplicate_items = sum(len(g['items']) for g in groups)

    return {
        'total_materials': len(materials),
        'groups_count': len(groups),
        'total_duplicate_items': total_duplicate_items,
        'groups': groups
    }

def check_single_material_duplicate(name, spec_model, exclude_mat_no=''):
    """
    Real-time check called during Material Modal typing.
    Detects if the input name/spec_model matches any existing item.
    """
    n_in = normalize_text(name)
    s_in = normalize_text(spec_model)

    if not s_in and not n_in:
        return []

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    SELECT material_no, name, spec_model, manufacturer, drawing_no, image_path, manual_path
    FROM materials
    WHERE material_no != ?
    ''', (exclude_mat_no or '',))
    all_materials = [dict(r) for r in cursor.fetchall()]
    conn.close()

    matches = []
    for m in all_materials:
        n_m = normalize_text(m['name'])
        s_m = normalize_text(m['spec_model'])

        matched = False
        reason = ''
        similarity = 0.0

        if s_in and s_m and s_in == s_m and len(s_in) >= 3:
            matched = True
            similarity = 1.0
            reason = f"规格型号与现有物料完全相同"
        elif n_in and n_m and n_in == n_m and s_in and s_m:
            spec_sim = difflib.SequenceMatcher(None, s_in, s_m).ratio()
            if spec_sim >= 0.92:
                matched = True
                similarity = round(spec_sim, 2)
                reason = f"物料同名且型号极似（相似度 {int(spec_sim*100)}%）"
        elif (n_in + s_in) and (n_m + s_m) and (n_in + s_in) == (n_m + s_m) and len(n_in + s_in) >= 4:
            matched = True
            similarity = 1.0
            reason = "名称与规格组合后与现有物料完全相同"

        if matched:
            matches.append({
                **m,
                'match_reason': reason,
                'similarity': similarity
            })

    matches.sort(key=lambda x: x.get('similarity', 0), reverse=True)
    return matches[:5]
