# blueprints/assets.py
"""
Static Asset Serving (Photos, Manuals) and File Upload APIs.

安全说明（P0 修复）：
- 所有由用户输入拼出的文件名必须经过 sanitize_asset_name 清洗；
- 落盘前必须通过 safe_path_under 校验最终路径仍在目标目录内（防路径穿越）；
- 必须按文件内容（magic bytes）而非仅扩展名校验类型，防止伪装上传。
"""

import os
from flask import Blueprint, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from services.database import get_db
from services.importer import import_excel_sbom
from services.backup_manager import create_backup_snapshot
from services.logging_setup import get_logger
from blueprints.common import (
    IMAGES_DIR,
    MANUALS_DIR,
    UPLOAD_DIR,
    sanitize_asset_name,
    safe_path_under,
    validate_upload_stream
)

logger = get_logger('sbom.assets')

assets_bp = Blueprint('assets', __name__)

ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.emf', '.webp']


# ----------------- Assets Serving -----------------
@assets_bp.route('/assets/images/<path:filename>')
def serve_image(filename):
    # 局域网关键优化：开启客户端 HTTP 强缓存（3天）与 ETag 条件请求，
    # 彻底释放 Waitress 后台线程，避免浏览物料时并发请求耗尽线程池
    response = send_from_directory(IMAGES_DIR, filename, max_age=259200)
    response.headers['Cache-Control'] = 'public, max-age=259200'
    return response


@assets_bp.route('/assets/manuals/<path:filename>')
def serve_manual(filename):
    as_attachment = request.args.get('download') in ['1', 'true', 'yes']
    # 下载名来自 URL 参数，必须清洗后再写入响应头，避免头部注入
    raw_custom = (request.args.get('filename') or '').strip()
    custom_name = sanitize_asset_name(raw_custom, fallback='') if raw_custom else ''
    if custom_name:
        base, ext = os.path.splitext(custom_name)
        if not ext:
            custom_name = base + '.pdf'
    else:
        custom_name = sanitize_asset_name(filename, fallback='manual.pdf')
        if not custom_name.lower().endswith('.pdf'):
            custom_name += '.pdf'

    if as_attachment:
        response = send_from_directory(
            MANUALS_DIR,
            filename,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=custom_name,
            max_age=86400
        )
    else:
        response = send_from_directory(MANUALS_DIR, filename, mimetype='application/pdf', max_age=86400)
        response.headers['Content-Disposition'] = f'inline; filename="{custom_name}"'
    response.headers['Cache-Control'] = 'public, max-age=86400'
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
    if ext not in ALLOWED_IMAGE_EXTS:
        return jsonify({'error': '仅支持 png, jpg, jpeg, webp, emf 图片'}), 400

    is_valid, err_msg = validate_upload_stream(file.stream, ext)
    if not is_valid:
        return jsonify({'error': err_msg}), 400

    # 【安全】清洗物料号 → 安全文件名主干，并校验最终落盘路径不越界
    safe_mat_no = sanitize_asset_name(mat_no, fallback='unnamed_material')
    filename = f"{safe_mat_no}{ext}"
    dest_path = safe_path_under(IMAGES_DIR, filename)
    if not dest_path:
        logger.warning("拒绝越界的图片写入请求: mat_no=%r", mat_no)
        return jsonify({'error': '非法的文件保存路径，已被安全策略拒绝'}), 400

    file.save(dest_path)
    rel_path = f"assets/images/{filename}"

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    INSERT INTO materials (material_no, image_path) VALUES (?, ?)
    ON CONFLICT(material_no) DO UPDATE SET image_path = excluded.image_path
    ''', (mat_no, rel_path))
    conn.commit()
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

    is_valid, err_msg = validate_upload_stream(file.stream, ext)
    if not is_valid:
        return jsonify({'error': err_msg}), 400

    # 【安全】原实现直接用未清洗的 mat_no 拼文件名，可被构造为 ..\..\evil 或 C:\evil 写出目录外
    safe_mat_no = sanitize_asset_name(mat_no, fallback='unnamed_material')
    filename = f"{safe_mat_no}.pdf"
    dest_path = safe_path_under(MANUALS_DIR, filename)
    if not dest_path:
        logger.warning("拒绝越界的手册写入请求: mat_no=%r", mat_no)
        return jsonify({'error': '非法的文件保存路径，已被安全策略拒绝'}), 400

    file.save(dest_path)
    rel_path = f"assets/manuals/{filename}"

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    INSERT INTO materials (material_no, manual_path) VALUES (?, ?)
    ON CONFLICT(material_no) DO UPDATE SET manual_path = excluded.manual_path
    ''', (mat_no, rel_path))
    conn.commit()
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
    save_path = safe_path_under(UPLOAD_DIR, filename)
    if not save_path:
        return jsonify({'error': '非法的文件名，已被安全策略拒绝'}), 400
    file.save(save_path)

    # 触发自动安全快照备份
    try:
        create_backup_snapshot(reason='import_excel', note=f'导入Excel模版 [{file.filename}] 前自动备份')
    except Exception as e_snap:
        logger.warning("导入 Excel 前自动备份失败: %s", e_snap)

    try:
        import_excel_sbom(save_path)
        return jsonify({'success': True, 'message': '导入成功'})
    except Exception as e:
        logger.exception("导入 Excel 失败: %s", save_path)
        return jsonify({'error': f'导入失败: {str(e)}'}), 500
