# blueprints/assets.py
"""
Static Asset Serving (Photos, Manuals) and File Upload APIs.
"""

import os
import re
from flask import Blueprint, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from services.database import get_db
from services.importer import import_excel_sbom
from services.backup_manager import create_backup_snapshot
from blueprints.common import (
    IMAGES_DIR,
    MANUALS_DIR,
    UPLOAD_DIR
)

assets_bp = Blueprint('assets', __name__)


# ----------------- Assets Serving -----------------
@assets_bp.route('/assets/images/<path:filename>')
def serve_image(filename):
    return send_from_directory(IMAGES_DIR, filename)


@assets_bp.route('/assets/manuals/<path:filename>')
def serve_manual(filename):
    as_attachment = request.args.get('download') in ['1', 'true', 'yes']
    custom_name = (request.args.get('filename') or '').strip() or filename
    if as_attachment:
        response = send_from_directory(
            MANUALS_DIR,
            filename,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=custom_name
        )
    else:
        response = send_from_directory(MANUALS_DIR, filename, mimetype='application/pdf')
        response.headers['Content-Disposition'] = f'inline; filename="{filename}"'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response


# ----------------- Asset Upload API -----------------
@assets_bp.route('/api/upload/image', methods=['POST'])
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': '未提供文件'}), 400
    file = request.files['file']
    mat_no = request.form.get('material_no', '').strip()
    if not mat_no or file.filename == '':
        return jsonify({'error': '未指定物料号或文件名为空'}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.png', '.jpg', '.jpeg', '.emf', '.webp']:
        return jsonify({'error': '仅支持 png, jpg, jpeg, webp 图片'}), 400

    safe_mat_no = re.sub(r'[\\/*?:"<>|]', '_', mat_no)
    filename = f"{safe_mat_no}{ext}"
    dest_path = os.path.join(IMAGES_DIR, filename)
    file.save(dest_path)
    rel_path = f"assets/images/{filename}"

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    INSERT INTO materials (material_no, image_path) VALUES (?, ?)
    ON CONFLICT(material_no) DO UPDATE SET image_path = excluded.image_path
    ''', (mat_no, rel_path))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'path': rel_path})


@assets_bp.route('/api/upload/manual', methods=['POST'])
def upload_manual():
    if 'file' not in request.files:
        return jsonify({'error': '未提供文件'}), 400
    file = request.files['file']
    mat_no = request.form.get('material_no', '').strip()
    if not mat_no or file.filename == '':
        return jsonify({'error': '未指定物料号或文件名为空'}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext != '.pdf':
        return jsonify({'error': '仅支持 PDF 格式手册'}), 400

    filename = f"{mat_no}.pdf"
    dest_path = os.path.join(MANUALS_DIR, filename)
    file.save(dest_path)
    rel_path = f"assets/manuals/{filename}"

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    INSERT INTO materials (material_no, manual_path) VALUES (?, ?)
    ON CONFLICT(material_no) DO UPDATE SET manual_path = excluded.manual_path
    ''', (mat_no, rel_path))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'path': rel_path})


# ----------------- Excel SBOM Import API -----------------
@assets_bp.route('/api/import', methods=['POST'])
def import_excel():
    if 'file' not in request.files:
        return jsonify({'error': '未选择文件'}), 400
    file = request.files['file']
    if file.filename == '' or not file.filename.endswith('.xlsx'):
        return jsonify({'error': '请上传有效的 .xlsx 文件'}), 400

    filename = secure_filename(file.filename) or 'upload.xlsx'
    save_path = os.path.join(UPLOAD_DIR, filename)
    file.save(save_path)

    # 触发自动安全快照备份
    try:
        create_backup_snapshot(reason='import_excel', note=f'导入Excel模版 [{file.filename}] 前自动备份')
    except Exception as e_snap:
        print("Auto-backup before excel import warning:", e_snap)

    try:
        import_excel_sbom(save_path)
        return jsonify({'success': True, 'message': '导入成功'})
    except Exception as e:
        return jsonify({'error': f'导入失败: {str(e)}'}), 500
