# blueprints/categories.py
"""
System Categories Blueprint: RESTful APIs for managing system categories (Pitch, Converter, etc.).
Allows dynamic creation, modification, and inspection of categories for scalable engineering.
"""

from flask import Blueprint, request, jsonify
from services import category_service
from services.logging_setup import get_logger

logger = get_logger('sbom.categories_api')
categories_bp = Blueprint('categories', __name__)


@categories_bp.route('/api/categories', methods=['GET'])
def get_categories():
    include_inactive = request.args.get('all', '0') in ('1', 'true', 'yes')
    try:
        categories = category_service.list_categories(include_inactive=include_inactive)
        return jsonify({
            'success': True,
            'categories': categories,
            'total': len(categories)
        })
    except Exception as e:
        logger.exception("获取分类列表失败: %s", str(e))
        return jsonify({'success': False, 'error': f'获取分类列表失败: {str(e)}'}), 500


@categories_bp.route('/api/categories/<string:code>', methods=['GET'])
def get_category_detail(code):
    try:
        cat = category_service.get_category(code)
        if not cat:
            return jsonify({'success': False, 'error': '未找到该分类'}), 404
        return jsonify({'success': True, 'category': cat})
    except Exception as e:
        return jsonify({'success': False, 'error': f'获取分类详情失败: {str(e)}'}), 500


@categories_bp.route('/api/categories', methods=['POST'])
def add_category():
    data = request.get_json(silent=True) or {}
    code = data.get('code')
    name = data.get('name')
    short_name = data.get('short_name', '')
    default_system_name = data.get('default_system_name', '')
    icon = data.get('icon', '📁')
    sort_order = data.get('sort_order', 0)
    description = data.get('description', '')

    ok, result = category_service.create_category(
        code=code,
        name=name,
        short_name=short_name,
        default_system_name=default_system_name,
        icon=icon,
        sort_order=sort_order,
        description=description
    )
    if not ok:
        return jsonify({'success': False, 'error': result}), 400
    return jsonify({'success': True, 'category': result})


@categories_bp.route('/api/categories/<string:code>', methods=['PUT', 'POST'])
def update_category_api(code):
    data = request.get_json(silent=True) or {}
    ok, result = category_service.update_category(code, data)
    if not ok:
        return jsonify({'success': False, 'error': result}), 400
    return jsonify({'success': True, 'category': result})


@categories_bp.route('/api/categories/<string:code>', methods=['DELETE'])
def delete_category_api(code):
    ok, msg = category_service.delete_category(code)
    if not ok:
        return jsonify({'success': False, 'error': msg}), 400
    return jsonify({'success': True, 'message': msg})
