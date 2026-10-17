# backup_manager.py
"""
Service BOM - Automatic Backup & Snapshot Rollback Engine
Handles SQLite atomic database snapshots using sqlite3.Connection.backup,
asset (images / manuals) archiving, manifest indexing, automatic rotation,
daily automatic backup, and safe rollback with safety checkpoints.

P0 修复说明：
原实现只备份 SQLite 数据库（约 150KB），而 assets/ 目录中上百 MB 的实物照片与技术手册
完全没有任何保护。数据库完好但资产丢失时，所有物料的图片与手册引用将全部断裂。
现补充：资产归档（assets_*.zip）、完整备份（数据库 + 资产）、每日自动备份。
"""

import os
import re
import json
import zipfile
import sqlite3
import datetime
import shutil
import threading
from flask import g, has_request_context
from .database import get_db, _create_connection
from .config import PROJECT_ROOT, config

BACKUP_DIR = os.path.join(PROJECT_ROOT, 'backups')
ASSETS_DIR = os.path.join(PROJECT_ROOT, 'assets')
MANIFEST_PATH = os.path.join(BACKUP_DIR, 'manifest.json')

def _sync_to_remote_backup(local_path):
    """若配置了 remote_backup_dir，自动异步拷贝至局域网远端/NAS共享目录。"""
    remote_dir = config.remote_backup_dir or os.environ.get('SBOM_REMOTE_BACKUP_DIR', '').strip()
    if not remote_dir or not os.path.exists(local_path):
        return
    def _do_copy():
        try:
            os.makedirs(remote_dir, exist_ok=True)
            fname = os.path.basename(local_path)
            shutil.copy2(local_path, os.path.join(remote_dir, fname))
        except Exception:
            pass
    threading.Thread(target=_do_copy, daemon=True).start()


# 资产归档相对较大，保留份数少于数据库快照
MAX_KEEP_DB = config.max_keep_db
MAX_KEEP_ASSETS = config.max_keep_assets

REASON_LABELS = {
    'manual': '手动备份',
    'full_manual': '手动完整备份(含图片手册)',
    'daily': '每日自动备份',
    'sync_master': '同步主库前自动备份',
    'sync_from_master': '从主库拉取更新前自动备份',
    'clear_master': '清空主库前自动备份',
    'delete_material': '删除物料前自动备份',
    'delete_project': '删除项目前自动备份',
    'import_excel': '导入Excel模版前自动备份',
    'import_master_excel': '批量导入物料库前自动备份',
    'open_project_file': '载入工程文件前自动备份',
    'pre_restore_checkpoint': '恢复快照前安全存档',
}


def format_size(bytes_size):
    if bytes_size < 1024:
        return f"{bytes_size} B"
    elif bytes_size < 1024 * 1024:
        return f"{bytes_size / 1024:.1f} KB"
    else:
        return f"{bytes_size / (1024 * 1024):.2f} MB"


def load_manifest():
    if not os.path.exists(MANIFEST_PATH):
        return []
    try:
        with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_manifest(manifest):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    tmp_path = MANIFEST_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, MANIFEST_PATH)


def _count_assets():
    """统计资产数量与总大小，写入备份元数据。"""
    total_size = 0
    file_count = 0
    for sub in ('images', 'manuals'):
        d = os.path.join(ASSETS_DIR, sub)
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            p = os.path.join(d, name)
            if os.path.isfile(p):
                file_count += 1
                try:
                    total_size += os.path.getsize(p)
                except Exception:
                    pass
    return file_count, total_size


def _prune(manifest, kind, max_keep):
    """按类型裁剪超出保留数量的备份，手动创建的尽量保留。"""
    kept = []
    for item in manifest:
        if item.get('kind') != kind:
            kept.append(item)
            continue
        # 已经统计到该类型的第几份
        same_kind_count = sum(1 for x in kept if x.get('kind') == kind)
        if same_kind_count < max_keep or item.get('reason') in ('manual', 'full_manual'):
            kept.append(item)
        else:
            old_path = os.path.join(BACKUP_DIR, item['filename'])
            if os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass
    return kept


def _insert_record(record):
    manifest = load_manifest()
    manifest.insert(0, record)
    manifest = _prune(manifest, 'db', MAX_KEEP_DB)
    manifest = _prune(manifest, 'assets', MAX_KEEP_ASSETS)
    manifest = _prune(manifest, 'full', MAX_KEEP_DB)
    save_manifest(manifest)

    # 局域网远端容灾：自动将最新快照异步同步至 NAS/远端目录
    if record.get('filename'):
        _sync_to_remote_backup(os.path.join(BACKUP_DIR, record['filename']))

    return record



def create_backup_snapshot(reason='manual', note='', max_keep=MAX_KEEP_DB):
    """
    Creates an atomic SQLite backup of the active database.
    返回快照元数据记录（kind='db'）。
    """
    os.makedirs(BACKUP_DIR, exist_ok=True)
    now = datetime.datetime.now()
    timestamp_str = now.strftime('%Y%m%d_%H%M%S')
    clean_reason = re.sub(r'[^a-zA-Z0-9_]', '_', reason)[:25]
    filename = f"snapshot_{timestamp_str}_{clean_reason}.db"
    dest_path = os.path.join(BACKUP_DIR, filename)

    source_conn = _create_connection()
    try:
        cur = source_conn.cursor()
        try:
            cur.execute('SELECT COUNT(*) FROM projects')
            projects_count = cur.fetchone()[0]
        except Exception:
            projects_count = 0

        try:
            cur.execute('SELECT COUNT(*) FROM materials')
            materials_count = cur.fetchone()[0]
        except Exception:
            materials_count = 0

        dest_conn = sqlite3.connect(dest_path)
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        source_conn.close()

    size_bytes = os.path.getsize(dest_path) if os.path.exists(dest_path) else 0

    record = {
        'kind': 'db',
        'filename': filename,
        'created_at': now.strftime('%Y-%m-%d %H:%M:%S'),
        'timestamp': int(now.timestamp()),
        'reason': reason,
        'reason_label': REASON_LABELS.get(reason, reason),
        'note': note or '',
        'size_bytes': size_bytes,
        'size_formatted': format_size(size_bytes),
        'projects_count': projects_count,
        'materials_count': materials_count
    }
    return _insert_record(record)


def create_asset_archive(reason='manual', note='', standalone=True):
    """
    Packs the entire assets directory (images + manuals) into a ZIP archive.
    返回归档元数据记录（kind='assets'）；若资产目录为空则返回 None。
    """
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if not os.path.isdir(ASSETS_DIR):
        return None

    file_count, total_size = _count_assets()
    if file_count == 0:
        return None

    now = datetime.datetime.now()
    timestamp_str = now.strftime('%Y%m%d_%H%M%S')
    clean_reason = re.sub(r'[^a-zA-Z0-9_]', '_', reason)[:25]
    filename = f"assets_{timestamp_str}_{clean_reason}.zip"
    dest_path = os.path.join(BACKUP_DIR, filename)

    with zipfile.ZipFile(dest_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for sub in ('images', 'manuals'):
            d = os.path.join(ASSETS_DIR, sub)
            if not os.path.isdir(d):
                continue
            for name in sorted(os.listdir(d)):
                p = os.path.join(d, name)
                if os.path.isfile(p):
                    zf.write(p, arcname=f"assets/{sub}/{name}")

    size_bytes = os.path.getsize(dest_path) if os.path.exists(dest_path) else 0
    record = {
        'kind': 'assets',
        'filename': filename,
        'created_at': now.strftime('%Y-%m-%d %H:%M:%S'),
        'timestamp': int(now.timestamp()),
        'reason': reason,
        'reason_label': REASON_LABELS.get(reason, reason) + '（图片与手册资产）',
        'note': note or '',
        'size_bytes': size_bytes,
        'size_formatted': format_size(size_bytes),
        'projects_count': 0,
        'materials_count': 0,
        'asset_file_count': file_count,
        'asset_original_size': total_size
    }

    if standalone:
        return _insert_record(record)
    return record


def create_full_backup(reason='full_manual', note=''):
    """
    完整备份 = 数据库快照 + 资产归档。
    返回 {'db': record_or_None, 'assets': record_or_None}
    """
    db_record = create_backup_snapshot(reason=reason, note=note)
    asset_record = None
    try:
        asset_record = create_asset_archive(reason=reason, note=note)
    except Exception:
        asset_record = None
    return {'success': True, 'db': db_record, 'assets': asset_record}


UPLOAD_DIR = os.path.join(PROJECT_ROOT, 'uploads')
EXPORT_DIR = os.path.join(PROJECT_ROOT, 'exports')


def cleanup_old_temp_files(max_age_seconds=86400):
    """
    清理 uploads/ 和 exports/ 目录下超过 max_age_seconds（默认 24 小时）的历史临时文件，
    防止并发导出包与历史上传文件无限占用磁盘空间。
    """
    import time
    now = time.time()
    cleaned_count = 0
    for d in (UPLOAD_DIR, EXPORT_DIR):
        if not os.path.exists(d):
            continue
        try:
            for entry in os.scandir(d):
                if entry.is_file() and not entry.name.startswith('.'):
                    try:
                        st = entry.stat()
                        if (now - st.st_mtime) > max_age_seconds:
                            os.remove(entry.path)
                            cleaned_count += 1
                    except Exception:
                        pass
        except Exception:
            pass
    return cleaned_count


def ensure_daily_backup():
    """
    启动时调用：若今天还没有自动备份，则创建一份完整备份（数据库 + 资产）。
    已存在今日的 'daily' 记录时直接跳过，避免频繁启动产生大量重复快照。
    顺带清理 uploads/ 和 exports/ 中超过 24 小时的历史临时文件。
    """
    try:
        cleanup_old_temp_files()
    except Exception:
        pass

    try:
        today = datetime.datetime.now().strftime('%Y-%m-%d')
        manifest = load_manifest()
        for item in manifest:
            if item.get('reason') == 'daily' and (item.get('created_at') or '').startswith(today):
                return None
        return create_full_backup(
            reason='daily',
            note=f'{today} 每日自动备份（数据库 + 全部图片手册资产）'
        )
    except Exception:
        return None


def list_backup_snapshots():
    """
    Returns list of existing backup snapshots, filtering out any missing files.
    """
    manifest = load_manifest()
    valid = []
    has_changes = False

    for item in manifest:
        item.setdefault('kind', 'db')
        fpath = os.path.join(BACKUP_DIR, item['filename'])
        if os.path.exists(fpath):
            real_size = os.path.getsize(fpath)
            if item.get('size_bytes') != real_size:
                item['size_bytes'] = real_size
                item['size_formatted'] = format_size(real_size)
                has_changes = True
            valid.append(item)
        else:
            has_changes = True

    if has_changes:
        save_manifest(valid)

    valid.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    return valid


def restore_backup_snapshot(filename):
    """
    Restores the active database from the given snapshot filename.
    Automatically creates a safety checkpoint of the current database before restoring.
    仅接受数据库快照（.db），资产归档需人工解压确认后再覆盖。
    """
    clean_filename = os.path.basename(filename)
    if not clean_filename.endswith('.db'):
        raise ValueError('只能恢复数据库快照(.db)；图片手册资产归档请下载后人工解压覆盖')

    src_path = os.path.join(BACKUP_DIR, clean_filename)
    if not os.path.exists(src_path):
        raise FileNotFoundError(f"未找到指定的快照文件: {clean_filename}")

    create_backup_snapshot(reason='pre_restore_checkpoint', note=f'恢复快照[{clean_filename}]前自动留存')

    src_conn = sqlite3.connect(src_path)
    active_conn = _create_connection()
    try:
        src_conn.backup(active_conn)
    finally:
        src_conn.close()
        active_conn.close()

    if has_request_context():
        conn = getattr(g, 'db', None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
            g.db = None

    return True


def delete_backup_snapshot(filename):
    """Deletes a specific snapshot file and updates the manifest."""
    clean_filename = os.path.basename(filename)
    fpath = os.path.join(BACKUP_DIR, clean_filename)
    if os.path.exists(fpath):
        os.remove(fpath)

    manifest = load_manifest()
    manifest = [m for m in manifest if m.get('filename') != clean_filename]
    save_manifest(manifest)
    return True


def get_backup_path(filename):
    """Returns verified absolute path to a snapshot file for downloading."""
    clean_filename = os.path.basename(filename)
    if clean_filename in (os.path.basename(MANIFEST_PATH),):
        return None
    fpath = os.path.join(BACKUP_DIR, clean_filename)
    if os.path.exists(fpath) and os.path.isfile(fpath):
        return fpath
    return None
