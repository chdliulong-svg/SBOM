# blueprints/backups.py
"""
Data Safety, SQLite WAL Zero-Lock Snapshots, Automatic Backups & One-Click Rollback APIs.
"""

import os
from flask import Blueprint, request, jsonify, send_file
from services.backup_manager import (
    create_backup_snapshot,
    list_backup_snapshots,
    restore_backup_snapshot,
    delete_backup_snapshot,
    get_backup_path
)

backups_bp = Blueprint('backups', __name__)


@backups_bp.route('/api/backups', methods=['GET'])
def api_list_backups():
    try:
        snapshots = list_backup_snapshots()
        return jsonify({'success': True, 'snapshots': snapshots})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@backups_bp.route('/api/backup/create', methods=['POST'])
def api_create_backup():
    data = request.json or {}
    note = (data.get('note') or '').strip()
    try:
        snap = create_backup_snapshot(reason='manual', note=note)
        return jsonify({'success': True, 'message': '快照创建成功', 'snapshot': snap})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@backups_bp.route('/api/backup/restore', methods=['POST'])
def api_restore_backup():
    data = request.json or {}
    filename = data.get('filename', '').strip()
    if not filename:
        return jsonify({'success': False, 'error': '未指定快照文件名'}), 400
    try:
        restore_backup_snapshot(filename)
        return jsonify({'success': True, 'message': f'成功恢复至快照: {filename}（系统已自动创建恢复前安全防护存档）'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@backups_bp.route('/api/backup/delete', methods=['POST'])
def api_delete_backup():
    data = request.json or {}
    filename = data.get('filename', '').strip()
    if not filename:
        return jsonify({'success': False, 'error': '未指定快照文件名'}), 400
    try:
        delete_backup_snapshot(filename)
        return jsonify({'success': True, 'message': '快照已成功删除'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@backups_bp.route('/api/backup/download/<path:filename>', methods=['GET'])
def api_download_backup(filename):
    path = get_backup_path(filename)
    if not path or not os.path.exists(path):
        return jsonify({'success': False, 'error': '快照文件不存在'}), 404
    return send_file(path, as_attachment=True, download_name=filename)
