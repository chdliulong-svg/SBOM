# blueprints/backups.py
"""
Data Safety, SQLite WAL Zero-Lock Snapshots, Asset Archiving,
Automatic Backups & One-Click Rollback APIs.
"""

import os
from flask import Blueprint, request, jsonify, send_file
from services.backup_manager import (
    create_backup_snapshot,
    create_asset_archive,
    create_full_backup,
    list_backup_snapshots,
    restore_backup_snapshot,
    delete_backup_snapshot,
    get_backup_path
)
from services.logging_setup import get_logger

logger = get_logger('sbom.backups')

backups_bp = Blueprint('backups', __name__)

_MIME_BY_EXT = {
    '.db': 'application/octet-stream',
    '.zip': 'application/zip',
}


@backups_bp.route('/api/backups', methods=['GET'])
def api_list_backups():
    try:
        snapshots = list_backup_snapshots()
        return jsonify({'success': True, 'snapshots': snapshots})
    except Exception as e:
        logger.exception("获取快照列表失败")
        return jsonify({'success': False, 'error': '获取快照列表失败，请查看服务日志'}), 500


@backups_bp.route('/api/backup/create', methods=['POST'])
def api_create_backup():
    data = request.json or {}
    note = (data.get('note') or '').strip()
    try:
        snap = create_backup_snapshot(reason='manual', note=note)
        return jsonify({'success': True, 'message': '数据库快照创建成功', 'snapshot': snap})
    except Exception as e:
        logger.exception("创建数据库快照失败")
        return jsonify({'success': False, 'error': '创建快照失败，请查看服务日志'}), 500


@backups_bp.route('/api/backup/create_full', methods=['POST'])
def api_create_full_backup():
    """
    完整备份：数据库快照 + assets 全部图片与手册归档。
    这才是真正可"一键还原整个系统"的备份。
    """
    data = request.json or {}
    note = (data.get('note') or '').strip()
    try:
        res = create_full_backup(reason='full_manual', note=note)
        db_rec = res.get('db')
        asset_rec = res.get('assets')
        if asset_rec:
            msg = (f'完整备份成功：数据库快照 {db_rec["size_formatted"]}'
                   f' + 资产归档 {asset_rec["size_formatted"]}'
                   f'（{asset_rec.get("asset_file_count", 0)} 个图片/手册文件）')
        else:
            msg = '数据库快照已创建；资产目录为空，未生成资产归档'
        return jsonify({'success': True, 'message': msg, 'db': db_rec, 'assets': asset_rec})
    except Exception as e:
        logger.exception("创建完整备份失败")
        return jsonify({'success': False, 'error': '创建完整备份失败，请查看服务日志'}), 500


@backups_bp.route('/api/backup/create_assets', methods=['POST'])
def api_create_assets_backup():
    """仅归档 assets 目录（图片 + 手册），不备份数据库。"""
    data = request.json or {}
    note = (data.get('note') or '').strip()
    try:
        rec = create_asset_archive(reason='manual', note=note)
        if not rec:
            return jsonify({'success': False, 'error': '资产目录为空，无需归档'}), 400
        return jsonify({
            'success': True,
            'message': f'已归档 {rec.get("asset_file_count", 0)} 个资产文件（{rec["size_formatted"]}）',
            'snapshot': rec
        })
    except Exception as e:
        logger.exception("创建资产归档失败")
        return jsonify({'success': False, 'error': '资产归档失败，请查看服务日志'}), 500


@backups_bp.route('/api/backup/restore', methods=['POST'])
def api_restore_backup():
    data = request.json or {}
    filename = data.get('filename', '').strip()
    if not filename:
        return jsonify({'success': False, 'error': '未指定快照文件名'}), 400
    try:
        restore_backup_snapshot(filename)
        return jsonify({'success': True, 'message': f'成功恢复至快照: {filename}（系统已自动创建恢复前安全防护存档）'})
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except FileNotFoundError as e:
        return jsonify({'success': False, 'error': str(e)}), 404
    except Exception as e:
        logger.exception("恢复快照失败: %s", filename)
        return jsonify({'success': False, 'error': '恢复快照失败，请查看服务日志'}), 500


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
        logger.exception("删除快照失败: %s", filename)
        return jsonify({'success': False, 'error': '删除快照失败，请查看服务日志'}), 500


@backups_bp.route('/api/backup/download/<path:filename>', methods=['GET'])
def api_download_backup(filename):
    path = get_backup_path(filename)
    if not path:
        return jsonify({'success': False, 'error': '快照文件不存在'}), 404
    ext = os.path.splitext(path)[1].lower()
    return send_file(
        path,
        as_attachment=True,
        download_name=os.path.basename(path),
        mimetype=_MIME_BY_EXT.get(ext, 'application/octet-stream')
    )
