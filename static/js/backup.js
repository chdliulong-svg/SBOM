// ==========================================
// Service BOM - Backup & Snapshot Rollback Module
// ==========================================

let currentBackupsList = [];

function openBackupModal() {
    openModal('backupModal');
    loadBackupsList();
}

async function loadBackupsList() {
    const container = document.getElementById('backupListContainer');
    if (!container) return;
    container.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 40px;">正在获取历史快照列表...</div>';

    try {
        const res = await safeFetchJson('/api/backups');
        if (!res.success) {
            container.innerHTML = `<div style="text-align: center; color: #dc2626; padding: 30px;">获取快照列表失败: ${res.error || '未知错误'}</div>`;
            return;
        }

        currentBackupsList = res.snapshots || [];
        const countEl = document.getElementById('backupListCount');
        if (countEl) countEl.textContent = currentBackupsList.length;

        if (currentBackupsList.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: #94a3b8; padding: 40px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;">
                    暂无历史快照记录。您可点击上方按钮创建第一份手工安全基线备份。
                </div>`;
            return;
        }

        let html = '';
        currentBackupsList.forEach((snap, idx) => {
            const isManual = snap.reason === 'manual';
            let badgeStyle = 'background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;';
            if (snap.reason === 'clear_master' || snap.reason === 'delete_project') {
                badgeStyle = 'background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;';
            } else if (snap.reason === 'sync_master') {
                badgeStyle = 'background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0;';
            } else if (snap.reason.startsWith('import')) {
                badgeStyle = 'background: #faf5ff; color: #7e22ce; border: 1px solid #e9d5ff;';
            } else if (snap.reason === 'pre_restore_checkpoint') {
                badgeStyle = 'background: #fffbeb; color: #b45309; border: 1px solid #fde68a;';
            }

            const noteDisplay = snap.note ? `<span style="color: #334155; font-weight: 500;">${escapeHtml(snap.note)}</span>` : '<span style="color: #94a3b8; font-style: italic;">无附加备注</span>';

            html += `
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; transition: all 0.15s ease;">
                    <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="font-weight: 700; font-size: 13px; color: #1e293b;">${snap.created_at}</span>
                            <span style="padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; ${badgeStyle}">${snap.reason_label}</span>
                            <span style="font-size: 11px; color: #64748b;">文件大小: <b>${snap.size_formatted}</b></span>
                            <span style="font-size: 11px; color: #64748b;">工程机型: <b>${snap.projects_count}</b> 个 · 通用物料: <b>${snap.materials_count}</b> 个</span>
                        </div>
                        <div style="font-size: 12px; color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            备注: ${noteDisplay}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                        <button type="button" class="btn btn-primary btn-sm" onclick="restoreBackup('${snap.filename}', '${snap.created_at}')" style="background: #0284c7; padding: 4px 10px;" title="将当前系统数据库完整回滚还原至该快照">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                            <span>还原</span>
                        </button>
                        <a href="/api/backup/download/${snap.filename}" class="btn btn-outline btn-sm" style="padding: 4px 10px;" title="下载该快照文件(.db)到本地电脑">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            <span>下载</span>
                        </a>
                        <button type="button" class="btn btn-outline btn-sm" onclick="deleteBackup('${snap.filename}')" style="color: #dc2626; border-color: #fca5a5; padding: 4px 8px;" title="删除该历史备份">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>`;
        });

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<div style="text-align: center; color: #dc2626; padding: 30px;">网络请求失败: ${err.message}</div>`;
    }
}

async function createManualBackup() {
    const input = document.getElementById('manualBackupNote');
    const note = (input ? input.value : '').trim();
    const btn = document.getElementById('btnCreateManualBackup');

    if (btn) btn.disabled = true;
    try {
        const res = await safeFetchJson('/api/backup/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note })
        });

        if (res.success) {
            showToast('手动安全快照创建成功！', 'success');
            if (input) input.value = '';
            loadBackupsList();
        } else {
            alert('创建快照失败: ' + (res.error || '未知错误'));
        }
    } catch (e) {
        alert('创建快照异常: ' + e.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function restoreBackup(filename, timeLabel) {
    const confirmMsg = `【重要数据恢复警告】\n\n您确定要将系统完整恢复至快照 [${timeLabel}] 吗？\n\n恢复操作将：\n1. 自动对当前工作区完整数据库建立一份“恢复前安全存档”；\n2. 将机型工程、物料主库与所有BOM数据精准覆盖回该快照时间点。\n\n是否确认恢复？`;
    if (!confirm(confirmMsg)) return;

    try {
        const res = await safeFetchJson('/api/backup/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });

        if (res.success) {
            showToast(res.message || '系统已成功恢复至指定快照！', 'success');
            // Refresh projects and current workspace
            loadProjects();
            loadMasterMaterials();
            loadBackupsList();
        } else {
            alert('快照恢复失败: ' + (res.error || '未知错误'));
        }
    } catch (e) {
        alert('快照恢复异常: ' + e.message);
    }
}

async function deleteBackup(filename) {
    if (!confirm(`确定要永久删除历史快照文件 [${filename}] 吗？`)) return;

    try {
        const res = await safeFetchJson('/api/backup/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });

        if (res.success) {
            showToast('历史快照已删除', 'info');
            loadBackupsList();
        } else {
            alert('删除快照失败: ' + (res.error || '未知错误'));
        }
    } catch (e) {
        alert('删除快照异常: ' + e.message);
    }
}
