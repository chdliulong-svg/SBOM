import sqlite3
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'service_bom.db')

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout = 30000;")
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
    except Exception:
        pass
    return conn

def find_template_path():
    """
    Locates the SBOM Excel template file in 'Excel 模版' directory.
    """
    tpl_dir = os.path.join(PROJECT_ROOT, 'Excel 模版')
    if os.path.exists(tpl_dir):
        primary = os.path.join(tpl_dir, 'SBOM_模版.xlsx')
        if os.path.exists(primary):
            return primary
        for fname in os.listdir(tpl_dir):
            if fname.endswith('.xlsx') and not fname.startswith('~$'):
                return os.path.join(tpl_dir, fname)
    return None

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Projects table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT DEFAULT '风力发电机组',
        system_name TEXT NOT NULL,
        doc_no TEXT DEFAULT '',
        ecn_no TEXT DEFAULT '',
        form_no TEXT DEFAULT 'FDJL-JS-037',
        company TEXT DEFAULT '上海电气风电集团股份有限公司',
        is_locked INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    # 2. Subsystems table (e.g. 盘古SBOM, 润盈SBOM)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS subsystems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        system_title TEXT DEFAULT '',
        doc_no TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
    ''')

    # 3. Materials Master Library (共享物料主库)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS materials (
        material_no TEXT PRIMARY KEY,
        description TEXT DEFAULT '',
        name TEXT DEFAULT '',
        spec_model TEXT DEFAULT '',
        manufacturer TEXT DEFAULT '',
        unit TEXT DEFAULT 'PCS',
        drawing_no TEXT DEFAULT '/',
        image_path TEXT DEFAULT '',
        manual_path TEXT DEFAULT '',
        substitute TEXT DEFAULT '',
        notes TEXT DEFAULT ''
    )
    ''')

    # 4. BOM Items (项目子系统BOM明细)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS bom_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subsystem_id INTEGER NOT NULL,
        row_num INTEGER DEFAULT 1,
        level_str TEXT DEFAULT '••',
        level_num INTEGER DEFAULT 2,
        seq_num TEXT DEFAULT '1',
        material_no TEXT NOT NULL,
        drawing_no TEXT DEFAULT '/',
        qty TEXT DEFAULT '1',
        unit TEXT DEFAULT 'PCS',
        notes TEXT DEFAULT '',
        substitute TEXT DEFAULT '',
        FOREIGN KEY (subsystem_id) REFERENCES subsystems(id) ON DELETE CASCADE,
        FOREIGN KEY (material_no) REFERENCES materials(material_no)
    )
    ''')

    # 5. Signatures (签字及修改页中的签名信息)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS signatures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        sign_name TEXT DEFAULT '',
        sign_date TEXT DEFAULT '',
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
    ''')

    # 6. ECN Records (更改记录)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS ecn_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        ecn_no TEXT DEFAULT '',
        change_desc TEXT DEFAULT '',
        changer TEXT DEFAULT '',
        change_date TEXT DEFAULT '',
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
    ''')

    # 7. Material Hierarchy Structures (物料子层级结构关系库)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS material_structures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_material_no TEXT NOT NULL,
        child_material_no TEXT NOT NULL,
        child_level_num INTEGER DEFAULT 2,
        child_level_str TEXT DEFAULT '••',
        sort_order INTEGER DEFAULT 1,
        qty TEXT DEFAULT '1',
        unit TEXT DEFAULT 'PCS',
        drawing_no TEXT DEFAULT '/',
        notes TEXT DEFAULT '',
        substitute TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_material_no) REFERENCES materials(material_no),
        FOREIGN KEY (child_material_no) REFERENCES materials(material_no)
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_mat_struct_parent ON material_structures(parent_material_no)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_mat_struct_child ON material_structures(child_material_no)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_bom_items_mat_no ON bom_items(material_no)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_bom_items_sub_id ON bom_items(subsystem_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_subsystems_proj_id ON subsystems(project_id)')

    # Migration for projects: add is_locked column if not present (default 1 for non-current, 0 for current)
    cursor.execute("PRAGMA table_info(projects)")
    proj_cols = [r['name'] for r in cursor.fetchall()]
    if 'is_locked' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN is_locked INTEGER DEFAULT 1")
        # By default, lock all non-current projects and unlock the most recent project (if any)
        cursor.execute("SELECT id FROM projects ORDER BY id DESC LIMIT 1")
        latest = cursor.fetchone()
        if latest:
            cursor.execute("UPDATE projects SET is_locked = 0 WHERE id = ?", (latest['id'],))
        conn.commit()

    # Migration for materials: add drawing_no column if not present
    cursor.execute("PRAGMA table_info(materials)")
    mat_cols = [r['name'] for r in cursor.fetchall()]
    if 'drawing_no' not in mat_cols:
        cursor.execute("ALTER TABLE materials ADD COLUMN drawing_no TEXT DEFAULT '/'")
        # Backfill drawing_no from bom_items where available
        cursor.execute('''
        UPDATE materials
        SET drawing_no = (
            SELECT drawing_no FROM bom_items
            WHERE bom_items.material_no = materials.material_no
              AND drawing_no IS NOT NULL AND drawing_no != '' AND drawing_no != '/'
            LIMIT 1
        )
        WHERE (drawing_no IS NULL OR drawing_no = '' OR drawing_no = '/')
          AND EXISTS (
            SELECT 1 FROM bom_items
            WHERE bom_items.material_no = materials.material_no
              AND drawing_no IS NOT NULL AND drawing_no != '' AND drawing_no != '/'
        )
        ''')

    # Migration for bom_items: add parent_material_no column if not present
    cursor.execute("PRAGMA table_info(bom_items)")
    raw_cols = cursor.fetchall()
    cols = {r['name']: (r['type'] or '').upper() for r in raw_cols}
    if 'parent_material_no' not in cols:
        cursor.execute("ALTER TABLE bom_items ADD COLUMN parent_material_no TEXT DEFAULT ''")
        conn.commit()
        sync_material_structures(conn)

    # Migration for bom_items: ensure seq_num has TEXT affinity
    if cols.get('seq_num') and 'INT' in cols.get('seq_num', ''):
        try:
            cursor.execute('PRAGMA foreign_keys = OFF')
            cursor.execute('''
            CREATE TABLE bom_items_migrated (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subsystem_id INTEGER NOT NULL,
                row_num INTEGER DEFAULT 1,
                level_str TEXT DEFAULT '••',
                level_num INTEGER DEFAULT 2,
                seq_num TEXT DEFAULT '1',
                material_no TEXT NOT NULL,
                drawing_no TEXT DEFAULT '/',
                qty TEXT DEFAULT '1',
                unit TEXT DEFAULT 'PCS',
                notes TEXT DEFAULT '',
                substitute TEXT DEFAULT '',
                parent_material_no TEXT DEFAULT '',
                FOREIGN KEY (subsystem_id) REFERENCES subsystems(id) ON DELETE CASCADE,
                FOREIGN KEY (material_no) REFERENCES materials(material_no)
            )
            ''')
            cursor.execute('''
            INSERT INTO bom_items_migrated (id, subsystem_id, row_num, level_str, level_num, seq_num, material_no, drawing_no, qty, unit, notes, substitute, parent_material_no)
            SELECT id, subsystem_id, row_num, level_str, level_num, CAST(seq_num AS TEXT), material_no, drawing_no, qty, unit, notes, substitute, parent_material_no
            FROM bom_items
            ''')
            cursor.execute('DROP TABLE bom_items')
            cursor.execute('ALTER TABLE bom_items_migrated RENAME TO bom_items')
            cursor.execute('PRAGMA foreign_keys = ON')
            conn.commit()
        except Exception as e:
            print("Warning migrating seq_num to TEXT:", e)
    else:
        conn.commit()
    conn.close()

def sync_material_structures(conn):
    """
    Scans bom_items across subsystems, builds hierarchical relationships,
    updates bom_items.parent_material_no, and populates material_structures.
    """
    cursor = conn.cursor()
    cursor.execute('''
    SELECT id, subsystem_id, row_num, level_num, level_str, material_no, drawing_no, qty, unit, notes, substitute
    FROM bom_items
    ORDER BY subsystem_id, row_num
    ''')
    rows = cursor.fetchall()
    
    current_sub = None
    stack = []
    
    for r in rows:
        item_id = r['id']
        sub_id = r['subsystem_id']
        lvl = r['level_num'] or 2
        lvl_str = r['level_str'] or '••'
        mat_no = r['material_no']
        dwg = r['drawing_no'] or '/'
        qty = r['qty'] or '1'
        unit = r['unit'] or 'PCS'
        notes = r['notes'] or ''
        sub = r['substitute'] or ''
        
        if sub_id != current_sub:
            current_sub = sub_id
            stack = []
            
        while stack and stack[-1][0] >= lvl:
            stack.pop()
            
        parent_mat = stack[-1][1] if stack else ''
        cursor.execute('UPDATE bom_items SET parent_material_no = ? WHERE id = ?', (parent_mat, item_id))
        
        if parent_mat:
            cursor.execute('''
            SELECT id FROM material_structures
            WHERE parent_material_no = ? AND child_material_no = ?
            ''', (parent_mat, mat_no))
            existing = cursor.fetchone()
            if not existing:
                cursor.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM material_structures WHERE parent_material_no = ?', (parent_mat,))
                next_sort = cursor.fetchone()[0]
                cursor.execute('''
                INSERT INTO material_structures (parent_material_no, child_material_no, child_level_num, child_level_str, sort_order, qty, unit, drawing_no, notes, substitute)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (parent_mat, mat_no, lvl, lvl_str, next_sort, qty, unit, dwg, notes, sub))
        
        stack.append((lvl, mat_no))
    
    conn.commit()

def get_material_tree(cursor, parent_material_no, visited=None, current_depth=1):
    """
    Recursively returns pre-order list of all descendant items under parent_material_no.
    Includes material master metadata (name, description, spec_model, etc.) and relative_depth.
    """
    if visited is None:
        visited = set()
    if parent_material_no in visited:
        return []
    visited.add(parent_material_no)

    cursor.execute('''
        SELECT s.*,
               COALESCE(NULLIF(s.drawing_no, '/'), NULLIF(s.drawing_no, ''), m.drawing_no, '/') as drawing_no,
               m.drawing_no as m_drawing_no,
               m.name as m_name, m.description as m_desc, m.spec_model as m_model,
               m.manufacturer as m_mfr, m.unit as m_unit, m.image_path, m.manual_path
        FROM material_structures s
        LEFT JOIN materials m ON s.child_material_no = m.material_no
        WHERE s.parent_material_no = ?
        ORDER BY s.sort_order, s.id
    ''', (parent_material_no,))
    direct_children = [dict(r) for r in cursor.fetchall()]

    result = []
    for child in direct_children:
        child['relative_depth'] = current_depth
        result.append(child)
        sub_children = get_material_tree(cursor, child['child_material_no'], visited, current_depth + 1)
        result.extend(sub_children)

    return result

if __name__ == '__main__':
    init_db()
    print("Database initialized successfully:", DB_PATH)
