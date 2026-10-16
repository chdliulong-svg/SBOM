// static/js/project_manager.js
/**
 * Service BOM - 全景项目工程管理中心 (Project Management Hub)
 * 简洁高效：工程统计指标、即时搜索与过滤、一键打开/切换、快速克隆、重命名、直连导出、批量管理
 */

let allProjectsData = [];
let pmSelectedProjectIds = new Set();
let pmIsMaximized = false;

// --- 打开与关闭项目管理弹窗 ---
function openProjectManagerModal() {
    pmSelectedProjectIds.clear();
    updatePmBatchButtons();

    // 默认检索与排序重置
    const sInput = document.getElementById('pmSearchInput');
    if (sInput) sInput.value = '';
    const fStatus = document.getElementById('pmFilterStatus');
    if (fStatus) fStatus.value = 'all';
    const fPlatform = document.getElementById('pmFilterPlatform');
    if (fPlatform) fPlatform.value = 'all';
    const sSort = document.getElementById('pmSortBy');
    if (sSort) sSort.value = 'updated_desc';

    openModal('projectManagerModal');
    loadProjectManagerData();
}

function closeProjectManagerModal() {
    closeModal('projectManagerModal');
}

function toggleProjectManagerModalMaximize() {
    const dialog = document.getElementById('projectManagerModalDialog');
    const maxBtn = document.getElementById('pmModalMaxBtn');
    if (!dialog) return;

    pmIsMaximized = !pmIsMaximized;
    if (pmIsMaximized) {
        dialog.classList.add('maximized');
        if (maxBtn) {
            maxBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M4 14h8a2 2 0 0 0 2-2V4M12 2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2"/>
                </svg>
            `;
            maxBtn.title = "还原窗口大小";
        }
    } else {
        dialog.classList.remove('maximized');
        if (maxBtn) {
            maxBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                    <rect x="2" y="2" width="12" height="12" rx="1.5"/>
                </svg>
            `;
            maxBtn.title = "最大化窗口";
        }
    }
}

// --- 数据获取与渲染 ---
async function loadProjectManagerData(quiet = false) {
    const loadingEl = document.getElementById('pmTableLoading');
    if (loadingEl && !quiet) loadingEl.style.display = 'flex';

    try {
        const res = await safeFetchJson('/api/projects');
        allProjectsData = Array.isArray(res) ? res : [];
        renderProjectManagerStats(allProjectsData);
        renderProjectManagerPlatformOptions(allProjectsData);
        filterAndRenderProjectManagerTable();
    } catch (err) {
        if (!quiet) alert('加载项目列表失败: ' + err.message);
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

// 统计看板渲染 (KPI Metrics)
function renderProjectManagerStats(projects) {
    const totalProjects = projects.length;
    const platforms = new Set();
    let totalSheets = 0;
    let totalItems = 0;
    let lockedCount = 0;

    projects.forEach(p => {
        if (p.platform && p.platform.trim()) platforms.add(p.platform.trim());
        totalSheets += (p.subsystem_count || 0);
        totalItems += (p.item_count || 0);
        if (p.is_locked == 1) lockedCount++;
    });

    const elTotal = document.getElementById('pmStatTotal');
    if (elTotal) elTotal.textContent = totalProjects;

    const elPlatforms = document.getElementById('pmStatPlatforms');
    if (elPlatforms) elPlatforms.textContent = platforms.size;

    const elSheets = document.getElementById('pmStatSheets');
    if (elSheets) elSheets.textContent = totalSheets;

    const elItems = document.getElementById('pmStatItems');
    if (elItems) elItems.textContent = totalItems.toLocaleString();

    const elLocked = document.getElementById('pmStatLocked');
    if (elLocked) elLocked.textContent = lockedCount;
}

// 机型平台下拉选项构建
function renderProjectManagerPlatformOptions(projects) {
    const sel = document.getElementById('pmFilterPlatform');
    if (!sel) return;

    const curVal = sel.value || 'all';
    const platforms = new Set();
    projects.forEach(p => {
        if (p.platform && p.platform.trim()) platforms.add(p.platform.trim());
    });

    const sorted = Array.from(platforms).sort();
    let opts = '<option value="all">全部机型平台</option>';
    sorted.forEach(plat => {
        opts += `<option value="${escapeHtml(plat)}" ${curVal === plat ? 'selected' : ''}>${escapeHtml(plat)}</option>`;
    });
    sel.innerHTML = opts;
}

// 筛选与排序逻辑
function filterAndRenderProjectManagerTable() {
    const query = (document.getElementById('pmSearchInput')?.value || '').trim().toLowerCase();
    const platFilter = document.getElementById('pmFilterPlatform')?.value || 'all';
    const statusFilter = document.getElementById('pmFilterStatus')?.value || 'all';
    const sortBy = document.getElementById('pmSortBy')?.value || 'updated_desc';

    let list = allProjectsData.slice();

    // 1. 关键字搜索 (代号/名称/系统名/平台/文件号/ECN)
    if (query) {
        const terms = query.split(/\s+/);
        list = list.filter(p => {
            const str = `${p.code || ''} ${p.name || ''} ${p.system_name || ''} ${p.platform || ''} ${p.doc_no || ''} ${p.ecn_no || ''} ${p.company || ''}`.toLowerCase();
            return terms.every(t => str.includes(t));
        });
    }

    // 2. 平台过滤
    if (platFilter !== 'all') {
        list = list.filter(p => (p.platform || '').trim() === platFilter);
    }

    // 3. 锁定状态过滤
    if (statusFilter === 'locked') {
        list = list.filter(p => p.is_locked == 1);
    } else if (statusFilter === 'unlocked') {
        list = list.filter(p => p.is_locked != 1);
    }

    // 4. 排序
    list.sort((a, b) => {
        if (sortBy === 'updated_desc') {
            const ta = a.updated_at || a.created_at || '';
            const tb = b.updated_at || b.created_at || '';
            return tb.localeCompare(ta);
        } else if (sortBy === 'updated_asc') {
            const ta = a.updated_at || a.created_at || '';
            const tb = b.updated_at || b.created_at || '';
            return ta.localeCompare(tb);
        } else if (sortBy === 'created_desc') {
            const ta = a.created_at || '';
            const tb = b.created_at || '';
            return tb.localeCompare(ta);
        } else if (sortBy === 'code_asc') {
            return (a.code || '').localeCompare(b.code || '');
        } else if (sortBy === 'items_desc') {
            return (b.item_count || 0) - (a.item_count || 0);
        }
        return b.id - a.id;
    });

    renderProjectManagerTable(list);
}

// 表格 DOM 渲染
function renderProjectManagerTable(projects) {
    const tbody = document.getElementById('pmTableBody');
    const emptyEl = document.getElementById('pmTableEmpty');
    const selectAllCb = document.getElementById('pmSelectAll');
    if (!tbody) return;

    if (!projects || projects.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = false;
        }
        updatePmBatchButtons();
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    let html = '';
    projects.forEach((p, idx) => {
        const isCurrent = (typeof currentProjectId !== 'undefined') && (currentProjectId == p.id);
        const isSelected = pmSelectedProjectIds.has(p.id);
        const code = p.code || '未命名机型';
        const name = p.name || '变桨系统Service BOM';
        const sysName = p.system_name || '';
        const platform = p.platform || '通用平台';
        const docNo = p.doc_no || '-';
        const ecnNo = p.ecn_no || '-';
        const sheets = p.subsystem_count || 0;
        const items = p.item_count || 0;
        const isLocked = p.is_locked == 1;
        const updatedTime = p.updated_at || p.created_at || '未记录';
        const createdTime = p.created_at || '未记录';

        // 状态徽标
        let statusBadge = '';
        if (isLocked) {
            const lockUser = p.locked_by ? ` (${escapeHtml(p.locked_by)})` : '';
            statusBadge = `
                <span class="pm-status-badge pm-status-locked" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;" title="工程处于锁定保护状态${lockUser}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    <span>只读保护</span>
                </span>
            `;
        } else {
            statusBadge = `
                <span class="pm-status-badge pm-status-unlocked" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0;" title="工程处于可编辑状态">
                    <span class="pm-status-dot" style="display: inline-block; width: 6px; height: 6px; background: #16a34a; border-radius: 50%;"></span>
                    <span>可编辑</span>
                </span>
            `;
        }

        // 当前打开高亮
        const rowClass = `pm-table-row ${isCurrent ? 'pm-row-current' : ''} ${isSelected ? 'pm-row-selected' : ''}`;
        const currentTag = isCurrent ? `<span class="pm-current-tag" style="font-size: 10px; font-weight: 600; background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; padding: 1px 6px; border-radius: 4px; white-space: nowrap;">当前打开</span>` : '';

        html += `
            <tr class="${rowClass}" data-id="${p.id}" ondblclick="openProjectFromManager(${p.id})">
                <td class="col-center" style="width: 44px;" onclick="event.stopPropagation()">
                    <input type="checkbox" class="pm-row-cb" value="${p.id}" ${isSelected ? 'checked' : ''} onchange="togglePmRowSelection(${p.id}, this.checked)">
                </td>
                <td class="col-center" style="width: 50px; color: #94a3b8; font-size: 12px;">${idx + 1}</td>
                <td style="min-width: 110px;">
                    <span class="pm-platform-badge" style="display: inline-block; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap;">${escapeHtml(platform)}</span>
                </td>
                <td style="min-width: 170px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <a href="javascript:void(0)" class="pm-code-link" onclick="openProjectFromManager(${p.id})" style="font-weight: 600; color: #2563eb; text-decoration: none;" title="点击进入此工程">${escapeHtml(code)}</a>
                        ${currentTag}
                    </div>
                </td>
                <td style="min-width: 220px;">
                    <div style="font-weight: 500; color: #1e293b;">${escapeHtml(name)}</div>
                    ${sysName ? `<div style="font-size: 12px; color: #64748b; margin-top: 2px;">${escapeHtml(sysName)}</div>` : ''}
                </td>
                <td style="min-width: 130px; font-size: 12px; color: #475569;">
                    <div>文: <span style="font-family: monospace;">${escapeHtml(docNo)}</span></div>
                    <div>ECN: <span style="font-family: monospace;">${escapeHtml(ecnNo)}</span></div>
                </td>
                <td class="col-center" style="min-width: 120px;">
                    <span class="pm-scale-badge" style="display: inline-block; background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; padding: 2px 7px; border-radius: 4px; font-size: 11px; white-space: nowrap;" title="${sheets} 个分系统 Sheet，包含 ${items} 行 BOM 物料">
                        ${sheets} Sheet · ${items} 行
                    </span>
                </td>
                <td class="col-center" style="min-width: 95px;">
                    ${statusBadge}
                </td>
                <td style="min-width: 160px; font-size: 12px; color: #334155;" title="创建时间: ${createdTime}">
                    <div style="display: inline-flex; align-items: center; gap: 4px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <b>${escapeHtml(updatedTime)}</b>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    // 更新全选框勾选状态
    if (selectAllCb) {
        const allChecked = projects.length > 0 && projects.every(p => pmSelectedProjectIds.has(p.id));
        const someChecked = projects.some(p => pmSelectedProjectIds.has(p.id));
        selectAllCb.checked = allChecked;
        selectAllCb.indeterminate = !allChecked && someChecked;
    }
    updatePmBatchButtons();
}

// --- 多选与批量操作交互 ---
function togglePmSelectAll(checked) {
    const cbs = document.querySelectorAll('.pm-row-cb');
    cbs.forEach(cb => {
        const id = parseInt(cb.value, 10);
        cb.checked = checked;
        if (checked) {
            pmSelectedProjectIds.add(id);
        } else {
            pmSelectedProjectIds.delete(id);
        }
    });

    document.querySelectorAll('.pm-table-row').forEach(tr => {
        const id = parseInt(tr.getAttribute('data-id'), 10);
        if (pmSelectedProjectIds.has(id)) {
            tr.classList.add('pm-row-selected');
        } else {
            tr.classList.remove('pm-row-selected');
        }
    });

    updatePmBatchButtons();
}

function togglePmRowSelection(projectId, checked) {
    if (checked) {
        pmSelectedProjectIds.add(projectId);
    } else {
        pmSelectedProjectIds.delete(projectId);
    }

    const row = document.querySelector(`.pm-table-row[data-id="${projectId}"]`);
    if (row) {
        if (checked) row.classList.add('pm-row-selected');
        else row.classList.remove('pm-row-selected');
    }

    const cbs = document.querySelectorAll('.pm-row-cb');
    const selectAllCb = document.getElementById('pmSelectAll');
    if (selectAllCb && cbs.length > 0) {
        let checkedCount = 0;
        cbs.forEach(cb => { if (cb.checked) checkedCount++; });
        selectAllCb.checked = checkedCount === cbs.length;
        selectAllCb.indeterminate = checkedCount > 0 && checkedCount < cbs.length;
    }
    updatePmBatchButtons();
}

function updatePmBatchButtons() {
    const count = pmSelectedProjectIds.size;
    const batchArea = document.getElementById('pmBatchActionArea');
    const countEl = document.getElementById('pmSelectedCountText');
    const singleArea = document.getElementById('pmSingleActionBtns');
    const batchExportBtn = document.getElementById('pmBatchExportBtn');
    if (!batchArea) return;

    if (count > 0) {
        batchArea.style.display = 'inline-flex';
        if (countEl) countEl.textContent = `已选 ${count} 项`;

        if (count === 1) {
            if (singleArea) singleArea.style.display = 'inline-flex';
            if (batchExportBtn) batchExportBtn.style.display = 'none';
            const firstId = Array.from(pmSelectedProjectIds)[0];
            const p = allProjectsData.find(item => item.id == firstId);
            const lockBtn = document.getElementById('pmBtnToggleLock');
            if (lockBtn && p) {
                lockBtn.innerHTML = p.is_locked == 1 ? '🔓 解锁' : '🔒 锁定';
                lockBtn.title = p.is_locked == 1 ? '点击解锁编辑' : '点击锁定保护';
            }
        } else {
            if (singleArea) singleArea.style.display = 'none';
            if (batchExportBtn) batchExportBtn.style.display = 'inline-block';
        }
    } else {
        batchArea.style.display = 'none';
    }
}

// 选中单个工程时的工具栏代理操作
function getSingleSelectedProject() {
    if (pmSelectedProjectIds.size !== 1) return null;
    const pid = Array.from(pmSelectedProjectIds)[0];
    return allProjectsData.find(item => item.id == pid) || null;
}

function openSelectedProjectFromManager() {
    const p = getSingleSelectedProject();
    if (!p) return;
    openProjectFromManager(p.id);
}

function exportSelectedSbomFromManager() {
    const p = getSingleSelectedProject();
    if (!p) return;
    quickExportSbomFromManager(p.id);
}

function exportSelectedExcelFromManager() {
    const p = getSingleSelectedProject();
    if (!p) return;
    quickExportExcelFromManager(p.id);
}

function copySelectedProjectFromManager() {
    const p = getSingleSelectedProject();
    if (!p) return;
    quickCopyProjectFromManager(p.id, p.code, p.name, p.system_name);
}

function renameSelectedProjectFromManager() {
    const p = getSingleSelectedProject();
    if (!p) return;
    quickRenameProjectFromManager(p.id, p.code, p.name, p.system_name);
}

function toggleLockSelectedProjectFromManager() {
    const p = getSingleSelectedProject();
    if (!p) return;
    toggleProjectLockFromManager(p.id, p.is_locked || 0);
}

// --- 快捷操作函数 ---
// 1. 进入工程
function openProjectFromManager(projectId) {
    closeProjectManagerModal();
    if (typeof loadProject === 'function') {
        loadProject(projectId);
        const p = allProjectsData.find(item => item.id == projectId);
        const code = p ? (p.code || p.name) : projectId;
        showToast(`已成功载入工程【${code}】！`, 'success');
    }
}

// 2. 导出下拉菜单控制
function togglePmExportMenu(e, projectId) {
    e.stopPropagation();
    const allMenus = document.querySelectorAll('.pm-export-menu');
    allMenus.forEach(m => {
        if (m.id !== `pmExportMenu-${projectId}`) m.classList.remove('show');
    });
    const menu = document.getElementById(`pmExportMenu-${projectId}`);
    if (menu) menu.classList.toggle('show');
}

// 点击页面其他区域关闭导出菜单
document.addEventListener('click', () => {
    document.querySelectorAll('.pm-export-menu').forEach(m => m.classList.remove('show'));
});

// 3. 快速导出单个工程
function quickExportSbomFromManager(projectId) {
    window.location.href = `/api/project/${projectId}/export_file`;
    showToast('正在生成并下载 .sbom 工程归档包...', 'info');
}

function quickExportExcelFromManager(projectId) {
    window.location.href = `/api/export/${projectId}`;
    showToast('正在导出标准 Excel Service BOM 清单...', 'info');
}

function quickExportOfflinePkgFromManager(projectId) {
    window.location.href = `/api/project/${projectId}/export_offline_package`;
    showToast('正在打包整机离线运维包，请稍候...', 'info');
}

// 4. 锁定 / 解锁切换
async function toggleProjectLockFromManager(projectId, currentLocked) {
    const isLocked = currentLocked == 1;
    const url = isLocked ? `/api/project/${projectId}/unlock` : `/api/project/${projectId}/lock`;
    try {
        const res = await safeFetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        if (res && res.success) {
            showToast(isLocked ? '已解锁该工程！' : '工程已切换为只读锁定保护！', 'info');
            loadProjectManagerData(true);
            // 若当前正在打开该工程，联动刷新顶部锁状态
            if (typeof currentProjectId !== 'undefined' && currentProjectId == projectId) {
                if (typeof loadProject === 'function') loadProject(projectId);
            }
        } else if (res && res.need_confirm) {
            if (confirm(res.error)) {
                const forceRes = await safeFetchJson(`/api/project/${projectId}/unlock`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ force: true })
                });
                if (forceRes && forceRes.success) {
                    showToast('已强制接管该工程编辑权限！', 'success');
                    loadProjectManagerData(true);
                } else {
                    alert((forceRes && forceRes.error) || '解锁接管失败');
                }
            }
        } else {
            alert((res && res.error) || '操作失败');
        }
    } catch (err) {
        alert('切换工程锁定状态异常: ' + err.message);
    }
}

// 5. 快速复制工程
function quickCopyProjectFromManager(projectId, curCode, curName, curSysName) {
    const defSys = curSysName ? `${curSysName}_副本` : `${curCode}_副本`;
    const newSys = prompt(`【复制工程】\n请输入复制出的新工程系统名称：`, defSys);
    if (!newSys || !newSys.trim()) return;

    const newCode = prompt(`请输入新工程机型代号 (如: ${curCode}-V2)：`, curCode);
    if (!newCode || !newCode.trim()) return;

    safeFetchJson('/api/project/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: projectId,
            code: newCode.trim(),
            system_name: newSys.trim()
        })
    }).then(res => {
        if (res && res.success) {
            showToast(`已成功复制新工程【${newSys.trim()}】！`, 'success');
            loadProjectManagerData(true);
            if (typeof refreshProjectSelectOnly === 'function') refreshProjectSelectOnly();
        } else {
            alert((res && res.error) || '复制工程失败');
        }
    }).catch(err => {
        alert('复制异常: ' + err.message);
    });
}

// 6. 快速重命名
function quickRenameProjectFromManager(projectId, curCode, curName, curSysName) {
    const newCode = prompt(`【重命名工程】\n1/2 请输入新的机型代号:`, curCode);
    if (newCode === null) return;
    const finalCode = newCode.trim() || curCode;

    const newSys = prompt(`2/2 请输入新的工程系统名称:`, curSysName || curName);
    if (newSys === null) return;
    const finalSys = newSys.trim();

    safeFetchJson('/api/project/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: projectId,
            code: finalCode,
            system_name: finalSys,
            name: curName
        })
    }).then(res => {
        if (res && res.success) {
            showToast('工程重命名成功！', 'success');
            loadProjectManagerData(true);
            if (typeof refreshProjectSelectOnly === 'function') refreshProjectSelectOnly();
            if (typeof currentProjectId !== 'undefined' && currentProjectId == projectId) {
                if (typeof loadProject === 'function') loadProject(projectId);
            }
        } else {
            alert((res && res.error) || '重命名失败');
        }
    }).catch(err => {
        alert('重命名异常: ' + err.message);
    });
}

// 7. 快速删除单个工程
function quickDeleteProjectFromManager(projectId, code, name, isLocked) {
    if (isLocked == 1) {
        alert(`工程【${code}】当前处于【锁定保护】状态，严禁删除！如需删除请先点击解锁。`);
        return;
    }

    if (!confirm(`⚠️ 危险操作确认：\n确定要永久删除工程【${code} ${name}】吗？\n（下属所有 Sheet、BOM 明细行及签字变更记录将被彻底移除，通用物料主库完整保留）`)) {
        return;
    }

    safeFetchJson('/api/project/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: projectId })
    }).then(res => {
        if (res && res.success) {
            showToast(res.message || '工程已成功永久删除！', 'info');
            pmSelectedProjectIds.delete(projectId);
            loadProjectManagerData(true);
            if (typeof refreshProjectSelectOnly === 'function') refreshProjectSelectOnly();
            if (typeof currentProjectId !== 'undefined' && currentProjectId == projectId) {
                if (typeof closeCurrentProject === 'function') closeCurrentProject();
            }
        } else {
            alert((res && res.error) || '删除工程失败');
        }
    }).catch(err => {
        alert('删除异常: ' + err.message);
    });
}

// --- 批量操作 ---
// 批量删除
async function batchDeleteProjectsFromManager() {
    const ids = Array.from(pmSelectedProjectIds);
    if (ids.length === 0) return;

    if (!confirm(`⚠️ 批量删除警告：\n您当前已勾选 ${ids.length} 个工程项目，确认全部永久删除吗？\n（注：其中处于【锁定保护】状态的项目系统将自动跳过保护，不会误删）`)) {
        return;
    }

    try {
        const res = await safeFetchJson('/api/projects/batch_delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
        });
        if (res && res.success) {
            showToast(res.message || `已成功批量删除 ${res.deleted_count} 个工程！`, 'success');
            pmSelectedProjectIds.clear();
            loadProjectManagerData(true);
            if (typeof refreshProjectSelectOnly === 'function') refreshProjectSelectOnly();
            if (typeof currentProjectId !== 'undefined' && ids.includes(currentProjectId)) {
                if (typeof closeCurrentProject === 'function') closeCurrentProject();
            }
        } else {
            alert((res && res.error) || '批量删除失败');
        }
    } catch (err) {
        alert('批量删除请求异常: ' + err.message);
    }
}

// 批量导出 .sbom ZIP 压缩包
async function batchExportSbomFromManager() {
    const ids = Array.from(pmSelectedProjectIds);
    if (ids.length === 0) return;

    showToast(`正在批量打包选中的 ${ids.length} 个工程文件，请稍候...`, 'info');

    try {
        const resp = await fetch('/api/projects/batch_export_bundle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
        });

        if (!resp.ok) {
            const errJson = await resp.json().catch(() => ({}));
            alert(errJson.error || '批量导出打包失败');
            return;
        }

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
        a.download = `Service_BOM_Projects_Batch_${ts}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('批量工程归档包下载成功！', 'success');
    } catch (err) {
        alert('批量导出异常: ' + err.message);
    }
}

// --- 辅助工具 ---
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// URL 参数与初始自动打开检查
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('view') === 'projects' || window.AUTO_OPEN_PROJECT_MANAGER) {
        setTimeout(() => {
            openProjectManagerModal();
        }, 150);
    }
});
