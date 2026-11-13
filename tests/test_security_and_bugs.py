import io
import os
import sys
import json
import zipfile
import tempfile
import unittest
from unittest.mock import patch

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import services.database as db_mod
import services.file_utils as fu_mod
import services.backup_manager as bm_mod
import services.auth_manager as auth_mod
import services.importer as imp_mod
import blueprints.common as common_bp
import blueprints.assets as assets_bp
import blueprints.materials as materials_bp
import blueprints.projects as projects_bp
from services.config import config


class IsolatedAppTestCase(unittest.TestCase):
    """Isolated integration & unit tests backed by a temporary workspace (never touching production data)."""

    @classmethod
    def setUpClass(cls):
        cls._tmpdir_obj = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.tmpdir = cls._tmpdir_obj.name
        cls.db_path = os.path.join(cls.tmpdir, 'test_service_bom.db')
        cls.upload_dir = os.path.join(cls.tmpdir, 'uploads')
        cls.export_dir = os.path.join(cls.tmpdir, 'exports')
        cls.images_dir = os.path.join(cls.tmpdir, 'assets', 'images')
        cls.manuals_dir = os.path.join(cls.tmpdir, 'assets', 'manuals')
        cls.backup_dir = os.path.join(cls.tmpdir, 'backups')
        for d in (cls.upload_dir, cls.export_dir, cls.images_dir, cls.manuals_dir, cls.backup_dir):
            os.makedirs(d, exist_ok=True)

        cls._orig_paths = {
            'db': db_mod.DB_PATH,
            'fu_upload': fu_mod.UPLOAD_DIR,
            'fu_export': fu_mod.EXPORT_DIR,
            'fu_img': fu_mod.IMAGES_DIR,
            'fu_man': fu_mod.MANUALS_DIR,
            'bm_dir': bm_mod.BACKUP_DIR,
            'bm_manifest': bm_mod.MANIFEST_PATH,
            'bm_assets': bm_mod.ASSETS_DIR,
            'cm_upload': common_bp.UPLOAD_DIR,
            'cm_export': common_bp.EXPORT_DIR,
            'cm_img': common_bp.IMAGES_DIR,
            'cm_man': common_bp.MANUALS_DIR,
            'as_upload': assets_bp.UPLOAD_DIR,
            'as_img': assets_bp.IMAGES_DIR,
            'as_man': assets_bp.MANUALS_DIR,
            'mt_upload': materials_bp.UPLOAD_DIR,
            'pr_upload': projects_bp.UPLOAD_DIR,
            'pr_export': projects_bp.EXPORT_DIR,
            'im_img': imp_mod.IMAGES_DIR,
            'im_man': imp_mod.MANUALS_DIR,
        }

        db_mod.DB_PATH = cls.db_path
        fu_mod.UPLOAD_DIR = cls.upload_dir
        fu_mod.EXPORT_DIR = cls.export_dir
        fu_mod.IMAGES_DIR = cls.images_dir
        fu_mod.MANUALS_DIR = cls.manuals_dir
        bm_mod.BACKUP_DIR = cls.backup_dir
        bm_mod.MANIFEST_PATH = os.path.join(cls.backup_dir, 'manifest.json')
        bm_mod.ASSETS_DIR = os.path.join(cls.tmpdir, 'assets')
        common_bp.UPLOAD_DIR = cls.upload_dir
        common_bp.EXPORT_DIR = cls.export_dir
        common_bp.IMAGES_DIR = cls.images_dir
        common_bp.MANUALS_DIR = cls.manuals_dir
        assets_bp.UPLOAD_DIR = cls.upload_dir
        assets_bp.IMAGES_DIR = cls.images_dir
        assets_bp.MANUALS_DIR = cls.manuals_dir
        materials_bp.UPLOAD_DIR = cls.upload_dir
        projects_bp.UPLOAD_DIR = cls.upload_dir
        projects_bp.EXPORT_DIR = cls.export_dir
        imp_mod.IMAGES_DIR = cls.images_dir
        imp_mod.MANUALS_DIR = cls.manuals_dir

        db_mod.init_db()
        from app import app
        cls.app = app
        cls.app.config['TESTING'] = True

    @classmethod
    def tearDownClass(cls):
        db_mod.DB_PATH = cls._orig_paths['db']
        fu_mod.UPLOAD_DIR = cls._orig_paths['fu_upload']
        fu_mod.EXPORT_DIR = cls._orig_paths['fu_export']
        fu_mod.IMAGES_DIR = cls._orig_paths['fu_img']
        fu_mod.MANUALS_DIR = cls._orig_paths['fu_man']
        bm_mod.BACKUP_DIR = cls._orig_paths['bm_dir']
        bm_mod.MANIFEST_PATH = cls._orig_paths['bm_manifest']
        bm_mod.ASSETS_DIR = cls._orig_paths['bm_assets']
        common_bp.UPLOAD_DIR = cls._orig_paths['cm_upload']
        common_bp.EXPORT_DIR = cls._orig_paths['cm_export']
        common_bp.IMAGES_DIR = cls._orig_paths['cm_img']
        common_bp.MANUALS_DIR = cls._orig_paths['cm_man']
        assets_bp.UPLOAD_DIR = cls._orig_paths['as_upload']
        assets_bp.IMAGES_DIR = cls._orig_paths['as_img']
        assets_bp.MANUALS_DIR = cls._orig_paths['as_man']
        materials_bp.UPLOAD_DIR = cls._orig_paths['mt_upload']
        projects_bp.UPLOAD_DIR = cls._orig_paths['pr_upload']
        projects_bp.EXPORT_DIR = cls._orig_paths['pr_export']
        imp_mod.IMAGES_DIR = cls._orig_paths['im_img']
        imp_mod.MANUALS_DIR = cls._orig_paths['im_man']
        cls._tmpdir_obj.cleanup()

    def setUp(self):
        with auth_mod._fail_lock:
            auth_mod._fail_tracker.clear()
        self._orig_trust_proxy = config.trust_proxy
        config.trust_proxy = False
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['sbom_authenticated'] = True

    def tearDown(self):
        config.trust_proxy = self._orig_trust_proxy

    def test_01_xff_spoofing_blocked_and_rate_limit(self):
        anon = self.app.test_client()
        # With trust_proxy=False, changing X-Forwarded-For must NOT bypass MAX_FAILS rate limit
        for i in range(auth_mod.MAX_FAILS):
            resp = anon.post(
                '/api/auth/login',
                json={'password': 'wrong-password'},
                headers={'X-Forwarded-For': f'203.0.113.{i + 1}'}
            )
            if i < auth_mod.MAX_FAILS - 1:
                self.assertEqual(resp.status_code, 401)
            else:
                self.assertEqual(resp.status_code, 429)

        # Subsequent request from same remote_addr is locked out even with another spoofed XFF
        resp_locked = anon.post(
            '/api/auth/login',
            json={'password': 'wrong-password'},
            headers={'X-Forwarded-For': '198.51.100.99'}
        )
        self.assertEqual(resp_locked.status_code, 429)

        # With trust_proxy=True, get_client_identity honors X-Forwarded-For; when False, uses remote_addr
        with self.app.test_request_context('/', headers={'X-Forwarded-For': '10.9.8.7'}):
            config.trust_proxy = False
            self.assertEqual(common_bp.get_client_identity(), '127.0.0.1')
            config.trust_proxy = True
            self.assertEqual(common_bp.get_client_identity(), '10.9.8.7')

    def test_02_path_traversal_blocked_on_import_endpoints(self):
        # Attempt path traversal on master Excel reanalyze & execute
        for url in ('/api/materials/import/reanalyze', '/api/materials/import/execute'):
            resp = self.client.post(url, json={'temp_filename': '../../app.py', 'sheet_name': 'Sheet1'})
            self.assertEqual(resp.status_code, 400)

        # Attempt path traversal on .sbom project open execute
        resp_proj = self.client.post('/api/project/open/execute', json={'temp_filename': '../../app.py'})
        self.assertEqual(resp_proj.status_code, 400)

    def test_03_xml_xxe_dtd_rejected(self):
        malicious_xxe = b'<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>'
        with self.assertRaises(ValueError):
            fu_mod.parse_safe_xml(malicious_xxe)

        valid_xml = b'<?xml version="1.0"?><root><item id="1">ok</item></root>'
        parsed = fu_mod.parse_safe_xml(valid_xml)
        self.assertEqual(parsed.find('item').text, 'ok')

    def test_04_project_save_category_and_heartbeat_takeover(self):
        # Create a converter project
        config.trust_proxy = True
        r_create = self.client.post(
            '/api/project/save',
            json={
                'code': 'CONV-01',
                'system_name': '3.X Converter SBOM',
                'category': 'converter',
                'platform': 'H4',
                'supplier': 'SupplierA',
                'model': 'MOD-1'
            },
            headers={'X-Forwarded-For': '10.1.1.10'}
        )
        self.assertEqual(r_create.status_code, 200)
        d = r_create.get_json()
        pid = d['id']
        self.assertEqual(d['category'], 'converter')

        # Update project without specifying category + clearing optional fields
        r_upd = self.client.post(
            '/api/project/save',
            json={
                'id': pid,
                'code': 'CONV-01',
                'system_name': '3.X Converter SBOM',
                'platform': '',
                'supplier': '',
                'model': '',
                'doc_no': '',
                'ecn_no': ''
            },
            headers={'X-Forwarded-For': '10.1.1.10'}
        )
        self.assertEqual(r_upd.status_code, 200)
        upd = r_upd.get_json()
        self.assertEqual(upd['category'], 'converter')
        self.assertEqual(upd['platform'], '')

        # Force takeover by another client
        r_take = self.client.post(
            f'/api/project/{pid}/unlock',
            json={'force': True},
            headers={'X-Forwarded-For': '10.1.1.20'}
        )
        self.assertEqual(r_take.status_code, 200)
        self.assertEqual(r_take.get_json()['locked_by'], '10.1.1.20')

        # Original holder heartbeat must detect takeover and NOT renew lease
        r_hb_old = self.client.post(
            f'/api/project/{pid}/heartbeat',
            headers={'X-Forwarded-For': '10.1.1.10'}
        )
        self.assertEqual(r_hb_old.status_code, 200)
        hb_old = r_hb_old.get_json()
        self.assertTrue(hb_old['taken_over'])
        self.assertFalse(hb_old['renewed'])
        self.assertEqual(hb_old['locked_by'], '10.1.1.20')

        # New holder heartbeat succeeds
        r_hb_new = self.client.post(
            f'/api/project/{pid}/heartbeat',
            headers={'X-Forwarded-For': '10.1.1.20'}
        )
        self.assertTrue(r_hb_new.get_json()['renewed'])
        self.assertFalse(r_hb_new.get_json()['taken_over'])

    def test_05_material_tree_cte_preorder_and_cycle_guard(self):
        conn = db_mod._create_connection()
        try:
            cur = conn.cursor()
            for mno in ('ASM-ROOT', 'SUB-1', 'PART-1A', 'SUB-2', 'CYC-A', 'CYC-B'):
                cur.execute("INSERT OR IGNORE INTO materials (material_no, name) VALUES (?, ?)", (mno, mno))
            cur.execute("DELETE FROM material_structures WHERE parent_material_no IN ('ASM-ROOT', 'SUB-1', 'SUB-2', 'CYC-A', 'CYC-B')")
            cur.execute(
                "INSERT INTO material_structures (parent_material_no, child_material_no, child_level_num, child_level_str, sort_order, qty, unit) VALUES (?, ?, 2, '••', 1, '1', 'PC')",
                ('ASM-ROOT', 'SUB-1')
            )
            cur.execute(
                "INSERT INTO material_structures (parent_material_no, child_material_no, child_level_num, child_level_str, sort_order, qty, unit) VALUES (?, ?, 3, '•••', 1, '2', 'PC')",
                ('SUB-1', 'PART-1A')
            )
            cur.execute(
                "INSERT INTO material_structures (parent_material_no, child_material_no, child_level_num, child_level_str, sort_order, qty, unit) VALUES (?, ?, 2, '••', 2, '1', 'PC')",
                ('ASM-ROOT', 'SUB-2')
            )
            # Cycle: CYC-A -> CYC-B -> CYC-A
            cur.execute(
                "INSERT INTO material_structures (parent_material_no, child_material_no, child_level_num, child_level_str, sort_order, qty, unit) VALUES (?, ?, 2, '••', 1, '1', 'PC')",
                ('CYC-A', 'CYC-B')
            )
            cur.execute(
                "INSERT INTO material_structures (parent_material_no, child_material_no, child_level_num, child_level_str, sort_order, qty, unit) VALUES (?, ?, 3, '•••', 1, '1', 'PC')",
                ('CYC-B', 'CYC-A')
            )
            conn.commit()

            tree = db_mod.get_material_tree(cur, 'ASM-ROOT')
            self.assertEqual(
                [(x['child_material_no'], x['relative_depth']) for x in tree],
                [('SUB-1', 1), ('PART-1A', 2), ('SUB-2', 1)]
            )

            cyc_tree = db_mod.get_material_tree(cur, 'CYC-A')
            self.assertEqual([x['child_material_no'] for x in cyc_tree], ['CYC-B'])
        finally:
            conn.close()

    def test_06_write_transaction_rollback_and_audit_logs(self):
        conn = db_mod._create_connection()
        try:
            with self.assertRaises(RuntimeError):
                with db_mod.write_transaction(conn):
                    conn.execute("INSERT INTO materials (material_no, name) VALUES (?, ?)", ('TX-ROLLBACK-1', 'Temp'))
                    raise RuntimeError("Simulated mid-transaction failure")
            row = conn.execute("SELECT 1 FROM materials WHERE material_no = ?", ('TX-ROLLBACK-1',)).fetchone()
            self.assertIsNone(row)
        finally:
            conn.close()

        r_logs = self.client.get('/api/audit/logs?limit=20')
        self.assertEqual(r_logs.status_code, 200)
        payload = r_logs.get_json()
        self.assertTrue(payload['success'])
        actions = [item['action'] for item in payload['logs']]
        self.assertIn('save_project', actions)
        self.assertIn('unlock_project', actions)

    def test_07_backup_full_retention_uses_max_keep_assets(self):
        orig_keep_db = bm_mod.MAX_KEEP_DB
        orig_keep_assets = bm_mod.MAX_KEEP_ASSETS
        try:
            bm_mod.MAX_KEEP_DB = 2
            bm_mod.MAX_KEEP_ASSETS = 4
            for i in range(5):
                fn = f"full_{i}.db"
                with open(os.path.join(self.backup_dir, fn), 'wb') as f:
                    f.write(b'x')
                bm_mod._insert_record({'filename': fn, 'kind': 'full', 'reason': 'daily', 'timestamp': i})
            manifest = bm_mod.load_manifest()
            full_items = [m for m in manifest if m.get('kind') == 'full']
            self.assertEqual(len(full_items), 4)
        finally:
            bm_mod.MAX_KEEP_DB = orig_keep_db
            bm_mod.MAX_KEEP_ASSETS = orig_keep_assets

    def test_08_asset_headers_and_export_temp_cleanup(self):
        img_file = os.path.join(self.images_dir, 'test_part.png')
        with open(img_file, 'wb') as f:
            f.write(b'\x89PNG\r\n\x1a\n' + b'\x00' * 32)
        man_file = os.path.join(self.manuals_dir, 'test_part.pdf')
        with open(man_file, 'wb') as f:
            f.write(b'%PDF-1.4\n%%EOF\n')

        r_img = self.client.get('/assets/images/test_part.png')
        self.assertEqual(r_img.status_code, 200)
        self.assertIn('must-revalidate', r_img.headers.get('Cache-Control', ''))
        r_img.close()

        r_man = self.client.get('/assets/manuals/test_part.pdf?filename=测试手册.pdf')
        self.assertEqual(r_man.status_code, 200)
        self.assertIn("filename*=UTF-8''", r_man.headers.get('Content-Disposition', ''))
        r_man.close()

        # Verify export_excel cleans up temporary EXPORT_DIR files after response
        r_proj = self.client.post('/api/project/save', json={'code': 'EXP-01', 'system_name': 'Export Test'})
        pid = r_proj.get_json()['id']
        r_exp = self.client.get(f'/api/export/{pid}')
        self.assertEqual(r_exp.status_code, 200)
        r_exp.close()
        leftover = os.listdir(self.export_dir)
        self.assertEqual(leftover, [])

    def test_09_import_excel_cleans_temp_on_invalid_file(self):
        bad_zip = io.BytesIO(b'not-a-valid-xlsx')
        r = self.client.post(
            '/api/import',
            data={'file': (bad_zip, 'BAD_IMPORT.XLSX'), 'category': 'converter', 'platform': 'H5'},
            content_type='multipart/form-data'
        )
        self.assertEqual(r.status_code, 500)
        self.assertNotIn('BadZipFile', r.get_json().get('error', ''))
        self.assertEqual(os.listdir(self.upload_dir), [])

    def test_10_bom_crud_move_and_frontend_security_checks(self):
        # Create project and add BOM items cleanly
        r_proj = self.client.post('/api/project/save', json={'code': 'BOM-01', 'system_name': 'BOM Tx Test'})
        self.assertEqual(r_proj.status_code, 200)
        proj = self.client.get(f"/api/project/{r_proj.get_json()['id']}").get_json()
        sub_id = proj['subsystems'][0]['id']

        r_add1 = self.client.post('/api/bom/add', json={'subsystem_id': sub_id, 'material_no': 'MAT-A', 'name': 'Part A', 'qty': '1'})
        r_add2 = self.client.post('/api/bom/add', json={'subsystem_id': sub_id, 'material_no': 'MAT-B', 'name': 'Part B', 'qty': '2'})
        self.assertEqual(r_add1.status_code, 200)
        self.assertEqual(r_add2.status_code, 200)

        items = self.client.get(f'/api/subsystem/{sub_id}/items').get_json()
        self.assertEqual([it['material_no'] for it in items], ['MAT-A', 'MAT-B'])

        # Move second item up cleanly within write_transaction
        r_mv = self.client.post('/api/bom/move', json={'id': items[1]['id'], 'direction': 'up'})
        self.assertEqual(r_mv.status_code, 200)
        items_after = self.client.get(f'/api/subsystem/{sub_id}/items').get_json()
        self.assertEqual([it['material_no'] for it in items_after], ['MAT-B', 'MAT-A'])

        # Delete first item cleanly and record audit log
        r_del = self.client.post('/api/bom/delete', json={'id': items_after[0]['id']})
        self.assertEqual(r_del.status_code, 200)
        items_final = self.client.get(f'/api/subsystem/{sub_id}/items').get_json()
        self.assertEqual([it['material_no'] for it in items_final], ['MAT-A'])

        # Verify frontend core.js escapes toast messages and project.js has no duplicate category key
        with open(os.path.join(PROJECT_ROOT, 'static', 'js', 'core.js'), 'r', encoding='utf-8') as f:
            core_js = f.read()
        self.assertIn('escapeHtml(String(message', core_js)
        self.assertNotIn('【变桨系统Service BOM 版本详情】', core_js)

        with open(os.path.join(PROJECT_ROOT, 'static', 'js', 'project.js'), 'r', encoding='utf-8') as f:
            proj_js = f.read()
        self.assertEqual(proj_js.count("category: (currentProjectData.category || 'pitch'),"), 1)
        self.assertIn('res.taken_over', proj_js)


if __name__ == '__main__':
    unittest.main(verbosity=2)
