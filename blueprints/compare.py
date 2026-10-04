# blueprints/compare.py
"""
Project Comparison, BOM Diff Analyzer, Procurement Increment Excel & ECN Generation.
"""

from flask import Blueprint, request, jsonify, send_file
from services.comparator import (
    compare_projects,
    generate_comparison_excel,
    generate_procurement_excel,
    generate_ecn_change_description
)

compare_bp = Blueprint('compare', __name__)


@compare_bp.route('/api/projects/compare', methods=['GET', 'POST'])
def compare_projects_api():
    if request.method == 'POST':
        data = request.json or {}
        proj_a_id = data.get('source_id') or data.get('proj_a_id')
        proj_b_id = data.get('target_id') or data.get('proj_b_id')
        subsystem = data.get('subsystem', 'all')
    else:
        proj_a_id = request.args.get('source_id') or request.args.get('proj_a_id')
        proj_b_id = request.args.get('target_id') or request.args.get('proj_b_id')
        subsystem = request.args.get('subsystem', 'all')

    if not proj_a_id or not proj_b_id:
        return jsonify({'success': False, 'error': '请选择需要比对的基准项目 (A) 和目标项目 (B)'}), 400

    try:
        res = compare_projects(int(proj_a_id), int(proj_b_id), subsystem_filter=subsystem)
        return jsonify(res)
    except Exception as e:
        return jsonify({'success': False, 'error': f'项目比对分析失败: {str(e)}'}), 500


@compare_bp.route('/api/projects/compare/export', methods=['GET', 'POST'])
def export_comparison_excel_api():
    if request.method == 'POST':
        data = request.json or {}
        proj_a_id = data.get('source_id') or data.get('proj_a_id')
        proj_b_id = data.get('target_id') or data.get('proj_b_id')
        subsystem = data.get('subsystem', 'all')
    else:
        proj_a_id = request.args.get('source_id') or request.args.get('proj_a_id')
        proj_b_id = request.args.get('target_id') or request.args.get('proj_b_id')
        subsystem = request.args.get('subsystem', 'all')

    if not proj_a_id or not proj_b_id:
        return jsonify({'success': False, 'error': '缺少比对项目ID'}), 400

    try:
        res = compare_projects(int(proj_a_id), int(proj_b_id), subsystem_filter=subsystem)
        buf, filename = generate_comparison_excel(res)
        return send_file(
            buf,
            as_attachment=True,
            download_name=filename,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        return jsonify({'success': False, 'error': f'导出比对报告失败: {str(e)}'}), 500


@compare_bp.route('/api/projects/compare/export_procurement', methods=['GET', 'POST'])
def export_procurement_excel_api():
    if request.method == 'POST':
        data = request.json or {}
        proj_a_id = data.get('source_id') or data.get('proj_a_id')
        proj_b_id = data.get('target_id') or data.get('proj_b_id')
        subsystem = data.get('subsystem', 'all')
    else:
        proj_a_id = request.args.get('source_id') or request.args.get('proj_a_id')
        proj_b_id = request.args.get('target_id') or request.args.get('proj_b_id')
        subsystem = request.args.get('subsystem', 'all')

    if not proj_a_id or not proj_b_id:
        return jsonify({'success': False, 'error': '缺少比对项目ID'}), 400

    try:
        res = compare_projects(int(proj_a_id), int(proj_b_id), subsystem_filter=subsystem)
        buf, filename = generate_procurement_excel(res)
        return send_file(
            buf,
            as_attachment=True,
            download_name=filename,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        return jsonify({'success': False, 'error': f'导出技改增量采购清单失败: {str(e)}'}), 500


@compare_bp.route('/api/projects/compare/generate_ecn', methods=['GET', 'POST'])
def generate_compare_ecn_api():
    if request.method == 'POST':
        data = request.json or {}
        proj_a_id = data.get('source_id') or data.get('proj_a_id')
        proj_b_id = data.get('target_id') or data.get('proj_b_id')
        subsystem = data.get('subsystem', 'all')
    else:
        proj_a_id = request.args.get('source_id') or request.args.get('proj_a_id')
        proj_b_id = request.args.get('target_id') or request.args.get('proj_b_id')
        subsystem = request.args.get('subsystem', 'all')

    if not proj_a_id or not proj_b_id:
        return jsonify({'success': False, 'error': '缺少比对项目ID'}), 400

    try:
        res = compare_projects(int(proj_a_id), int(proj_b_id), subsystem_filter=subsystem)
        ecn_res = generate_ecn_change_description(res)
        return jsonify(ecn_res)
    except Exception as e:
        return jsonify({'success': False, 'error': f'生成 ECN 变更说明失败: {str(e)}'}), 500
