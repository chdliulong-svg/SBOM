# backup_manager.py
"""
Service BOM - Automatic Backup & Snapshot Rollback Engine
Handles SQLite atomic database snapshots using sqlite3.Connection.backup,
manifest indexing, automatic rotation, and safe rollback with safety checkpoints.
"""

import os
import re
import json
import sqlite3
import datetime
from .database import get_db

BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backups')
MANIFEST_PATH = os.path.join(BACKUP_DIR, 'manifest.json')

REASON_LABELS = {
    'manual': '手动备份',
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
            return json.load(f)
    except Exception:
        return []

def save_manifest(manifest):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

def create_backup_snapshot(reason='manual', note='', max_keep=30):
    """
    Creates an atomic SQLite backup of the active database.
    """
    os.makedirs(BACKUP_DIR, exist_ok=True)
    now = datetime.datetime.now()
    timestamp_str = now.strftime('%Y%m%d_%H%M%S')
    clean_reason = re.sub(r'[^a-zA-Z0-9_]', '_', reason)[:25]
    filename = f"snapshot_{timestamp_str}_{clean_reason}.db"
    dest_path = os.path.join(BACKUP_DIR, filename)

    source_conn = get_db()
    try:
        # Query counts for snapshot metadata
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

        # Perform atomic backup copy
        dest_conn = sqlite3.connect(dest_path)
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        source_conn.close()

    size_bytes = os.path.getsize(dest_path) if os.path.exists(dest_path) else 0

    record = {
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

    manifest = load_manifest()
    # Prepend new record
    manifest.insert(0, record)

    # Prune old backups if count exceeds max_keep (preserve manual backups if possible)
    if len(manifest) > max_keep:
        kept = []
        for item in manifest:
            if len(kept) < max_keep or item.get('reason') == 'manual':
                kept.append(item)
            else:
                old_path = os.path.join(BACKUP_DIR, item['filename'])
                if os.path.exists(old_path):
                    try:
                        os.remove(old_path)
                    except Exception:
                        pass
        manifest = kept

    save_manifest(manifest)
    return record

def list_backup_snapshots():
    """
    Returns list of existing backup snapshots, filtering out any missing files.
    """
    manifest = load_manifest()
    valid = []
    has_changes = False

    for item in manifest:
        fpath = os.path.join(BACKUP_DIR, item['filename'])
        if os.path.exists(fpath):
            # Update real file size
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

    # Sort descending by timestamp
    valid.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
    return valid

def restore_backup_snapshot(filename):
    """
    Restores the active database from the given snapshot filename.
    Automatically creates a safety checkpoint of the current database before restoring.
    """
    clean_filename = os.path.basename(filename)
    src_path = os.path.join(BACKUP_DIR, clean_filename)
    if not os.path.exists(src_path):
        raise FileNotFoundError(f"未找到指定的快照文件: {clean_filename}")

    # 1. Create safety checkpoint of current active state
    create_backup_snapshot(reason='pre_restore_checkpoint', note=f'恢复快照[{clean_filename}]前自动留存')

    # 2. Perform atomic restore using backup API into active DB
    src_conn = sqlite3.connect(src_path)
    active_conn = get_db()
    try:
        src_conn.backup(active_conn)
    finally:
        src_conn.close()
        active_conn.close()

    return True

def delete_backup_snapshot(filename):
    """
    Deletes a specific snapshot file and updates the manifest.
    """
    clean_filename = os.path.basename(filename)
    fpath = os.path.join(BACKUP_DIR, clean_filename)
    if os.path.exists(fpath):
        os.remove(fpath)

    manifest = load_manifest()
    manifest = [m for m in manifest if m.get('filename') != clean_filename]
    save_manifest(manifest)
    return True

def get_backup_path(filename):
    """
    Returns verified absolute path to a snapshot file for downloading.
    """
    clean_filename = os.path.basename(filename)
    fpath = os.path.join(BACKUP_DIR, clean_filename)
    if os.path.exists(fpath):
        return fpath
    return None
