// ==========================================
// Service BOM - Material Master Intelligent Duplicate Management Module
// ==========================================

let currentDuplicateReport = null;
let dupCheckDebounceTimer = null;

function openAuditModal() {
    const searchInput = document.getElementById('auditSearchInput');
    if (searchInput) searchInput.value = '';
    openModal('auditModal');
    loadAuditReport();
}

async function loadAuditReport() {
    const container = document.getElementById('auditDuplicateGroupsContainer');
    const summaryText = document.getElementById('auditDuplicateSummaryText');
    if (container) {
        container.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 40px; font-size: 13px;">正在深度扫描主库物料、归一化比对规格型号并检索工程引用...</div>';
    }
    if (summaryText) {
        summaryText.textContent = '正在扫描主库一物多码重复物料...';
    }

    try {
        const res = await safeFetchJson('/api/materials/audit');
        if (!res.success) {
            alert('查重扫描失败: ' + (res.error || '未知错误'));
            return;
        }

        currentDuplicateReport = res.report || {};
        renderDuplicateReport(currentDuplicateReport);
    } catch (err) {
        if (container) {
            container.innerHTML = `<div style="text-align: center; color: #dc2626; padding: 30px; font-size: 13px;">查重请求异常: ${escapeHtml(err.message)}</div>`;
        }
    }
}

function filterAuditDuplicateGroups() {
    const searchInput = document.getElementById('auditSearchInput');
    const kw = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (currentDuplicateReport) {
        renderDuplicateReport(currentDuplicateReport, kw);
    }
}

function renderDuplicateReport(rep, filterKeyword = '') {
    const container = document.getElementById('auditDuplicateGroupsContainer');
    const summaryText = document.getElementById('auditDuplicateSummaryText');
    if (!container) return;

    const totalMaterials = rep.total_materials || 0;
    const allGroups = rep.groups || [];
    const totalDuplicates = rep.total_duplicate_items || 0;

    let groups = allGroups;
    if (filterKeyword) {
        groups = allGroups.filter(g => {
            if ((g.spec_title || '').toLowerCase().includes(filterKeyword)) return true;
            if ((g.name_title || '').toLowerCase().includes(filterKeyword)) return true;
            if ((g.reason || '').toLowerCase().includes(filterKeyword)) return true;
            return (g.items || []).some(m => 
                (m.material_no || '').toLowerCase().includes(filterKeyword) ||
                (m.name || '').toLowerCase().includes(filterKeyword) ||
                (m.spec_model || '').toLowerCase().includes(filterKeyword) ||
                (m.manufacturer || '').toLowerCase().includes(filterKeyword)
            );
        });
    }

    if (summaryText) {
        if (allGroups.length === 0) {
            summaryText.innerHTML = `全库共 <b>${totalMaterials}</b> 个物料 · <span style="color: #16a34a; font-weight: 600;">未发现一物多码重复录入</span>`;
        } else {
            summaryText.innerHTML = `全库共 <b>${totalMaterials}</b> 个物料 · 共检出 <b style="color: #dc2626;">${allGroups.length}</b> 组一物多码重复（涉及 <b style="color: #dc2626;">${totalDuplicates}</b> 个物料编码）${filterKeyword ? ` · 当前过滤显示 ${groups.length} 组` : ''}`;
        }
    }

    if (groups.length === 0) {
        if (filterKeyword) {
            container.innerHTML = `<div style="text-align: center; color: #64748b; padding: 40px; font-size: 13px;">未检索到包含「${escapeHtml(filterKeyword)}」的重复分组。</div>`;
        } else {
            container.innerHTML = `
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 40px 20px; text-align: center;">
                    <div style="font-size: 32px; margin-bottom: 8px;">🎉</div>
                    <div style="font-size: 15px; font-weight: 700; color: #166534; margin-bottom: 4px;">太棒了！未发现相同规格型号的重复物料条目</div>
                    <div style="font-size: 12px; color: #15803d;">主库物料命名规范良好，所有物料号与规格型号保持唯一对齐。</div>
                </div>`;
        }
        return;
    }

    let html = '';
    groups.forEach((group, idx) => {
        html += `
            <div class="duplicate-group-card" style="background: #ffffff; border: 1px solid #fed7aa; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                <!-- Group Header -->
                <div style="background: #fff7ed; border-bottom: 1px solid #ffedd5; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="background: #ea580c; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px;">重复组 #${idx + 1}</span>
                        <span style="font-size: 14px; font-weight: 700; color: #9a3412;">规格型号: ${escapeHtml(group.spec_title || group.name_title)}</span>
                        <span style="font-size: 11px; color: #c2410c; background: #ffedd5; padding: 1px 8px; border-radius: 4px; font-weight: 600;">共 ${group.items_count} 个不同编码</span>
                    </div>
                    <div style="font-size: 11px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; padding: 2px 8px; border-radius: 4px;">
                        ${escapeHtml(group.reason)}
                    </div>
                </div>

                <!-- Group Items Table -->
                <div style="padding: 10px 16px; overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
                        <thead>
                            <tr style="border-bottom: 1px solid #f1f5f9; color: #64748b; font-weight: 600;">
                                <th style="padding: 6px 8px; width: 40px;">序号</th>
                                <th style="padding: 6px 8px; width: 130px;">物料号</th>
                                <th style="padding: 6px 8px; width: 130px;">元器件名称</th>
                                <th style="padding: 6px 8px;">规格型号</th>
                                <th style="padding: 6px 8px; width: 90px;">制造商</th>
                                <th style="padding: 6px 8px; width: 80px;">图纸代号</th>
                                <th style="padding: 6px 8px; width: 110px;">图片 / 手册</th>
                                <th style="padding: 6px 8px; width: 220px;">工程项目引用状态</th>
                                <th style="padding: 6px 8px; width: 130px; text-align: center;">操作</th>
                            </tr>
                        </thead>
                        <tbody>`;

        (group.items || []).forEach((item, itemIdx) => {
            const hasImg = !!item.image_path;
            const hasManual = !!item.manual_path;
            const inUse = !!item.is_in_use;
            const rowBg = inUse ? '#ffffff' : '#fffaf5';

            // Attachment badges
            let attachHtml = '<div style="display: flex; align-items: center; gap: 4px;">';
            if (hasImg) {
                const imgUrl = item.image_path.startsWith('/') ? item.image_path : '/' + item.image_path;
                attachHtml += `<span onclick="if (typeof showImgPreview === 'function') showImgPreview('${escapeHtml(imgUrl)}');" style="cursor: pointer; color: #0284c7; background: #e0f2fe; padding: 1px 5px; border-radius: 3px; font-size: 11px;" title="查看实物照片">🖼️ 图</span>`;
            }
            if (hasManual) {
                const manUrl = item.manual_path.startsWith('/') ? item.manual_path : '/' + item.manual_path;
                attachHtml += `<span onclick="if (typeof previewManualOnline === 'function') previewManualOnline('${escapeHtml(manUrl)}', '${escapeHtml(item.material_no)}', '${escapeHtml(item.name || '')}');" style="cursor: pointer; color: #dc2626; background: #fee2e2; padding: 1px 5px; border-radius: 3px; font-size: 11px;" title="查看技术手册PDF">📄 册</span>`;
            }
            if (!hasImg && !hasManual) {
                attachHtml += '<span style="color: #cbd5e1; font-size: 11px;">-</span>';
            }
            attachHtml += '</div>';

            // Reference status badge
            let refHtml = '';
            if (inUse) {
                refHtml = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; font-size: 11px; font-weight: 600;" title="引用项目: ${escapeHtml(item.ref_projects || '')}">
                    ✓ 已引用: ${item.ref_count} 个项目 ${item.ref_projects ? '[' + escapeHtml(item.ref_projects) + ']' : ''} ${item.struct_refs > 0 ? '(总成 ' + item.struct_refs + ' 处)' : ''}
                </span>`;
            } else {
                refHtml = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: #fef2f2; color: #b91c1c; border: 1px dashed #fca5a5; font-size: 11px; font-weight: 500;">
                    未被任何项目引用 (冗余备件)
                </span>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; background: ${rowBg};">
                    <td style="padding: 8px 8px; color: #94a3b8;">${itemIdx + 1}</td>
                    <td style="padding: 8px 8px;">
                        <span style="font-weight: 700; color: #1e3a8a; font-family: monospace;">${escapeHtml(item.material_no)}</span>
                    </td>
                    <td style="padding: 8px 8px; font-weight: 600; color: #1e293b;">${escapeHtml(item.name || '-')}</td>
                    <td style="padding: 8px 8px; color: #0369a1; font-family: monospace;">${escapeHtml(item.spec_model || '-')}</td>
                    <td style="padding: 8px 8px; color: #475569;">${escapeHtml(item.manufacturer || '-')}</td>
                    <td style="padding: 8px 8px; color: #64748b;">${escapeHtml(item.drawing_no || '/')}</td>
                    <td style="padding: 8px 8px;">${attachHtml}</td>
                    <td style="padding: 8px 8px;">${refHtml}</td>
                    <td style="padding: 8px 8px; text-align: center;">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                            <button type="button" class="btn btn-outline btn-sm" onclick="closeModal('auditModal'); openEditMasterModal('${escapeHtml(item.material_no)}')" style="font-size: 11px; padding: 2px 7px;">
                                编辑
                            </button>
                            <button type="button" class="btn btn-danger btn-sm" onclick="deleteDuplicateItem('${escapeHtml(item.material_no)}', '${escapeHtml(item.spec_model || '')}', ${item.ref_count}, '${escapeHtml(item.ref_projects || '')}', ${item.struct_refs})" style="font-size: 11px; padding: 2px 7px; background: #dc2626; color: #fff; border: 1px solid #b91c1c;" title="从物料主库中直接删除此条冗余物料">
                                一键删除
                            </button>
                        </div>
                    </td>
                </tr>`;
        });

        html += `
                        </tbody>
                    </table>
                </div>
            </div>`;
    });

    container.innerHTML = html;
}

// One-click delete redundant duplicate item
async function deleteDuplicateItem(matNo, specModel, refCount, refProjects, structRefs) {
    if (refCount > 0 || structRefs > 0) {
        let warnMsg = `⚠️ 强力警示：\n\n物料 [${matNo}] 当前已被引用：\n`;
        if (refCount > 0) {
            warnMsg += `• 引用工程项目: ${refCount} 个 (${refProjects})\n`;
        }
        if (structRefs > 0) {
            warnMsg += `• 总成层级引用: ${structRefs} 处\n`;
        }
        warnMsg += `\n强制删除该物料将导致上述项目的 BOM 明细关联断链！\n\n请再次确认：您确定仍然要强制删除物料 [${matNo}] 吗？`;
        if (!confirm(warnMsg)) return;
    } else {
        if (!confirm(`确定要从物料主库中删除重复物料 [${matNo}] 吗？\n\n该条目未被任何工程项目引用，可安全一键清理。`)) {
            return;
        }
    }

    try {
        const res = await safeFetchJson('/api/material/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ material_no: matNo })
        });

        if (res.success) {
            showToast(`物料 [${matNo}] 已成功删除，系统已自动备份快照。`, 'success');
            // Refresh duplicate groups report in-place
            loadAuditReport();
            // Also refresh master table and stats in background
            if (typeof loadMasterMaterials === 'function') loadMasterMaterials();
            if (typeof loadMasterStats === 'function') loadMasterStats();
            if (typeof currentSubsystemId !== 'undefined' && currentSubsystemId && typeof loadBomItems === 'function') {
                loadBomItems(currentSubsystemId);
            }
        } else {
            alert(res.error || '删除失败');
        }
    } catch (err) {
        alert('删除请求异常: ' + err.message);
    }
}

// Real-time check called during Material Modal typing
function checkInputMaterialDuplicate() {
    clearTimeout(dupCheckDebounceTimer);
    dupCheckDebounceTimer = setTimeout(async () => {
        const nameInput = document.getElementById('mm-name');
        const specInput = document.getElementById('mm-spec-model');
        const matNoInput = document.getElementById('mm-mat-no');
        const warnBox = document.getElementById('mat-dup-warning-box');
        if (!warnBox) return;

        const name = (nameInput ? nameInput.value : '').trim();
        const spec = (specInput ? specInput.value : '').trim();
        const matNo = (matNoInput ? matNoInput.value : '').trim();

        if (!name && !spec) {
            warnBox.style.display = 'none';
            return;
        }

        try {
            const url = `/api/materials/check_duplicate?name=${encodeURIComponent(name)}&spec_model=${encodeURIComponent(spec)}&mat_no=${encodeURIComponent(matNo)}`;
            const res = await safeFetchJson(url);
            if (res.success && res.matches && res.matches.length > 0) {
                const top = res.matches[0];
                warnBox.style.display = 'block';
                warnBox.innerHTML = `
                    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 12px; font-size: 12px; color: #92400e; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <div>
                            <b>⚠️ 智能查重预警:</b> 主库已存在高相似物料 [<b>${escapeHtml(top.material_no)}</b>: ${escapeHtml(top.name || '')} / ${escapeHtml(top.spec_model || '')}]，请确认是否为同一备件，谨防一物多码！
                        </div>
                        <button type="button" class="btn btn-outline btn-sm" onclick="openEditMasterModal('${escapeHtml(top.material_no)}')" style="background: #fff; font-size: 11px; padding: 2px 8px; white-space: nowrap;">
                            对比现有物料
                        </button>
                    </div>`;
            } else {
                warnBox.style.display = 'none';
            }
        } catch (e) {
            warnBox.style.display = 'none';
        }
    }, 300);
}
