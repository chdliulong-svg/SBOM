import sqlite3
import os

from flask import g, has_request_context

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'service_bom.db')

def _create_connection():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout = 30000;")
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA foreign_keys = ON;")
    except Exception:
        pass
    return conn

def get_db():
    """
    获取数据库连接。
    在 Flask 请求上下文中自动复用 g.db 并在请求结束时通过 teardown_appcontext 统一安全回收；
    在后台线程或命令行任务中返回独立的连接。
    """
    if has_request_context():
        conn = getattr(g, 'db', None)
        if conn is not None:
            try:
                conn.execute("SELECT 1")
                return conn
            except Exception:
                pass
        conn = _create_connection()
        g.db = conn
        return conn
    return _create_connection()

def close_db(e=None):
    """Flask teardown 钩子：请求结束时安全关闭连接，释放锁资源。"""
    if has_request_context():
        conn = getattr(g, 'db', None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
            g.db = None


def find_template_path():
    """
    Locates the SBOM Excel template file 'SBOM_模版V2.xlsx' in 'Excel 模版' directory.
    """
    tpl_dir = os.path.join(PROJECT_ROOT, 'Excel 模版')
    if os.path.exists(tpl_dir):
        primary = os.path.join(tpl_dir, 'SBOM_模版V2.xlsx')
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
        code TEXT NOT NULL DEFAULT '',
        name TEXT DEFAULT '风力发电机组',
        system_name TEXT NOT NULL DEFAULT '',
        doc_no TEXT DEFAULT '',
        ecn_no TEXT DEFAULT '',
        form_no TEXT DEFAULT 'FDJL-JS-037',
        company TEXT DEFAULT '上海电气风电集团股份有限公司',
        is_locked INTEGER DEFAULT 1,
        locked_by TEXT DEFAULT '',
        locked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
        updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
        platform TEXT DEFAULT '',
        supplier TEXT DEFAULT '',
        model TEXT DEFAULT ''
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
        supplier TEXT DEFAULT '',
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
        unit TEXT DEFAULT 'PC',
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
        unit TEXT DEFAULT 'PC',
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
        change_pos TEXT DEFAULT '',
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
        unit TEXT DEFAULT 'PC',
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
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_bom_items_sub_row ON bom_items(subsystem_id, row_num)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_subsystems_proj_id ON subsystems(project_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_materials_name ON materials(name)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_materials_spec ON materials(spec_model)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_materials_mfr ON materials(manufacturer)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_projects_platform ON projects(platform)')

    # Migration for projects: add is_locked, locked_by, locked_at, platform columns if not present
    cursor.execute("PRAGMA table_info(projects)")
    proj_cols = [r['name'] for r in cursor.fetchall()]
    if 'is_locked' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN is_locked INTEGER DEFAULT 1")
    if 'locked_by' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN locked_by TEXT DEFAULT ''")
    if 'locked_at' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN locked_at TIMESTAMP")
    if 'platform' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN platform TEXT DEFAULT ''")
    if 'supplier' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN supplier TEXT DEFAULT ''")
    if 'model' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN model TEXT DEFAULT ''")
    if 'created_at' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN created_at TIMESTAMP")
    if 'updated_at' not in proj_cols:
        cursor.execute("ALTER TABLE projects ADD COLUMN updated_at TIMESTAMP")

    # Migration for subsystems: add supplier column if not present
    cursor.execute("PRAGMA table_info(subsystems)")
    sub_cols = [r['name'] for r in cursor.fetchall()]
    if 'supplier' not in sub_cols:
        cursor.execute("ALTER TABLE subsystems ADD COLUMN supplier TEXT DEFAULT ''")
    
    # 补齐已有历史数据的创建时间与修改时间
    cursor.execute("UPDATE projects SET created_at = datetime('now', 'localtime') WHERE created_at IS NULL OR created_at = ''")
    cursor.execute("UPDATE projects SET updated_at = COALESCE(created_at, datetime('now', 'localtime')) WHERE updated_at IS NULL OR updated_at = ''")
    conn.commit()

    # 自动维护 projects.updated_at 的数据库级触发器
    cursor.execute('DROP TRIGGER IF EXISTS trg_projects_update_touch')
    cursor.execute('''
    CREATE TRIGGER IF NOT EXISTS trg_projects_update_touch
    AFTER UPDATE ON projects
    FOR EACH ROW
    WHEN (
        OLD.code IS NOT NEW.code OR
        OLD.name IS NOT NEW.name OR
        OLD.system_name IS NOT NEW.system_name OR
        OLD.platform IS NOT NEW.platform OR
        OLD.supplier IS NOT NEW.supplier OR
        OLD.model IS NOT NEW.model OR
        OLD.doc_no IS NOT NEW.doc_no OR
        OLD.ecn_no IS NOT NEW.ecn_no OR
        OLD.form_no IS NOT NEW.form_no OR
        OLD.company IS NOT NEW.company
    ) AND OLD.updated_at IS NEW.updated_at
    BEGIN
        UPDATE projects SET updated_at = datetime('now', 'localtime') WHERE id = NEW.id;
    END;
    ''')

    cursor.execute('''
    CREATE TRIGGER IF NOT EXISTS trg_subsystems_insert_touch
    AFTER INSERT ON subsystems
    FOR EACH ROW
    BEGIN
        UPDATE projects SET updated_at = datetime('now', 'localtime') WHERE id = NEW.project_id;
    END;
    ''')
    cursor.execute('''
    CREATE TRIGGER IF NOT EXISTS trg_subsystems_update_touch
    AFTER UPDATE ON subsystems
    FOR EACH ROW
    BEGIN
        UPDATE projects SET updated_at = datetime('now', 'localtime') WHERE id = NEW.project_id;
    END;
    ''')
    cursor.execute('''
    CREATE TRIGGER IF NOT EXISTS trg_subsystems_delete_touch
    AFTER DELETE ON subsystems
    FOR EACH ROW
    BEGIN
        UPDATE projects SET updated_at = datetime('now', 'localtime') WHERE id = OLD.project_id;
    END;
    ''')

    cursor.execute('''
    CREATE TRIGGER IF NOT EXISTS trg_bom_items_insert_touch
    AFTER INSERT ON bom_items
    FOR EACH ROW
    BEGIN
        UPDATE projects SET updated_at = datetime('now', 'localtime')
        WHERE id = (SELECT project_id FROM subsystems WHERE id = NEW.subsystem_id);
    END;
    ''')
    cursor.execute('''
    CREATE TRIGGER IF NOT EXISTS trg_bom_items_update_touch
    AFTER UPDATE ON bom_items
    FOR EACH ROW
    BEGIN
        UPDATE projects SET updated_at = datetime('now', 'localtime')
        WHERE id = (SELECT project_id FROM subsystems WHERE id = NEW.subsystem_id);
    END;
    ''')
    cursor.execute('''
    CREATE TRIGGER IF NOT EXISTS trg_bom_items_delete_touch
    AFTER DELETE ON bom_items
    FOR EACH ROW
    BEGIN
        UPDATE projects SET updated_at = datetime('now', 'localtime')
        WHERE id = (SELECT project_id FROM subsystems WHERE id = OLD.subsystem_id);
    END;
    ''')

    cursor.execute('''
    CREATE TRIGGER IF NOT EXISTS trg_signatures_touch
    AFTER UPDATE ON signatures
    FOR EACH ROW
    BEGIN
        UPDATE projects SET updated_at = datetime('now', 'localtime') WHERE id = NEW.project_id;
    END;
    ''')
    cursor.execute('''
    CREATE TRIGGER IF NOT EXISTS trg_ecn_records_touch
    AFTER UPDATE ON ecn_records
    FOR EACH ROW
    BEGIN
        UPDATE projects SET updated_at = datetime('now', 'localtime') WHERE id = NEW.project_id;
    END;
    ''')
    conn.commit()

    # Migration for ecn_records: add change_pos column if not present
    cursor.execute("PRAGMA table_info(ecn_records)")
    ecn_cols = [r['name'] for r in cursor.fetchall()]
    if 'change_pos' not in ecn_cols:
        cursor.execute("ALTER TABLE ecn_records ADD COLUMN change_pos TEXT DEFAULT ''")
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
                unit TEXT DEFAULT 'PC',
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

    # Automatic V2 migration: if any old dotted seq_num exists, upgrade all to V2 step-10 format
    cursor.execute("SELECT id FROM bom_items WHERE seq_num LIKE '%.%' LIMIT 1")
    if cursor.fetchone():
        try:
            from blueprints.common import renumber_subsystem
            cursor.execute("SELECT id FROM subsystems")
            all_subs = cursor.fetchall()
            for sub in all_subs:
                renumber_subsystem(cursor, sub['id'], mode='step10')
            conn.commit()
        except Exception as e:
            print("Warning renumbering subsystems to step-10:", e)

    # Automatic migration: Remove UNIQUE constraint on projects.code
    # Projects are identified by integer primary key id; project codes (机型/项目代号) are output fields that can be repeated
    try:
        cursor.execute("PRAGMA index_list('projects')")
        has_unique_code = False
        for idx_row in cursor.fetchall():
            if idx_row['unique'] == 1:
                cursor.execute(f"PRAGMA index_info('{idx_row['name']}')")
                cols = [col['name'] for col in cursor.fetchall()]
                if cols == ['code']:
                    has_unique_code = True
                    break
        if has_unique_code:
            cursor.execute("PRAGMA foreign_keys = OFF")
            cursor.execute('''
            CREATE TABLE projects_migrated (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL DEFAULT '',
                name TEXT DEFAULT '风力发电机组',
                system_name TEXT NOT NULL DEFAULT '',
                doc_no TEXT DEFAULT '',
                ecn_no TEXT DEFAULT '',
                form_no TEXT DEFAULT 'FDJL-JS-037',
                company TEXT DEFAULT '上海电气风电集团股份有限公司',
                is_locked INTEGER DEFAULT 1,
                locked_by TEXT DEFAULT '',
                locked_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                platform TEXT DEFAULT ''
            )
            ''')
            cursor.execute('''
            INSERT INTO projects_migrated (id, code, name, system_name, doc_no, ecn_no, form_no, company, is_locked, locked_by, locked_at, created_at, platform)
            SELECT id, code, name, system_name, doc_no, ecn_no, form_no, company, is_locked, locked_by, locked_at, created_at, platform
            FROM projects
            ''')
            cursor.execute('DROP TABLE projects')
            cursor.execute('ALTER TABLE projects_migrated RENAME TO projects')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_projects_code ON projects(code)')
            cursor.execute('PRAGMA foreign_keys = ON')
            conn.commit()
    except Exception as e:
        print("Warning migrating projects table to remove unique constraint on code:", e)

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
        unit = r['unit'] or 'PC'
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
    if current_depth > 10:
        return []
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


def touch_project_updated(project_id, cursor=None):
    """
    主动刷新项目的上次修改时间为当前系统本地时间。
    如果外部未传入 cursor，则自动创建临时连接并立即 commit。
    """
    if not project_id:
        return
    need_commit = False
    if cursor is None:
        conn = get_db()
        cursor = conn.cursor()
        need_commit = True
    try:
        cursor.execute("UPDATE projects SET updated_at = datetime('now', 'localtime') WHERE id = ?", (project_id,))
        if need_commit:
            conn.commit()
    except Exception:
        pass


if __name__ == '__main__':
    init_db()
    print("Database initialized successfully:", DB_PATH)
