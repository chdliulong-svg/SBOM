// ==========================================
// Service BOM - Project Lifecycle, Revision, ECN & Bundles
// ==========================================
let currentMainCategory = 'all';
let currentMainPlatform = 'all';
let allMainProjectsCache = [];
let allMainCategoriesCache = [
    { code: 'pitch', name: '变桨系统', default_system_name: '变桨系统', icon: '' },
    { code: 'converter', name: '变流器系统', default_system_name: '变流器系统', icon: '' }
];
let isProjectMetadataDirty = false;

function setProjectDirty(dirty) {
    isProjectMetadataDirty = !!dirty && !!(currentProjectData && currentProjectData.is_locked != 1);
    const dot = document.getElementById('projectUnsavedDot');
    const btn = document.getElementById('btnProjectSave');
    if (dot) dot.style.display = isProjectMetadataDirty ? 'inline-block' : 'none';
    if (btn) btn.classList.toggle('is-dirty', isProjectMetadataDirty);
}

function confirmDiscardProjectChanges() {
    if (!isProjectMetadataDirty) return true;
    return confirm('当前工程的封面或签字页存在未保存修改，确定放弃修改并切换/关闭吗？');
}

function handleMainProjectSelectChange(val) {
    if (!confirmDiscardProjectChanges()) {
        const sel = document.getElementById('projectSelect');
        if (sel) sel.value = currentProjectId ? String(currentProjectId) : '';
        return;
    }
    loadProject(val);
}

function initProjectDirtyListeners() {
    const coverFormIds = ['cov-code', 'cov-platform', 'cov-supplier', 'cov-model', 'cov-name', 'cov-system', 'cov-doc', 'cov-ecn', 'cov-form', 'cov-company'];
    const sigIds = [
        'sig-author-name', 'sig-author-date',
        'sig-reviewer-name', 'sig-reviewer-date',
        'sig-checker-name', 'sig-checker-date',
        'sig-countersign-name', 'sig-countersign-date',
        'sig-standard-name', 'sig-standard-date',
        'sig-approver-name', 'sig-approver-date'
    ];
    [...coverFormIds, ...sigIds].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.dataset.dirtyBound !== 'true') {
            el.dataset.dirtyBound = 'true';
            el.addEventListener('input', () => setProjectDirty(true));
            el.addEventListener('change', () => setProjectDirty(true));
        }
    });
}

function getMainFilteredProjects() {
    let list = allMainProjectsCache || [];
    if (currentMainCategory && currentMainCategory !== 'all') {
        list = list.filter(p => (p.category || 'pitch').toLowerCase() === currentMainCategory.toLowerCase());
    }
    if (currentMainPlatform && currentMainPlatform !== 'all') {
        list = list.filter(p => ((p.platform || '').trim()) === currentMainPlatform);
    }
    return list;
}

        function renderProjectSelectOptions(projects, selectedId = null) {
            const sel = document.getElementById('projectSelect');
            if (!sel) return;
            if (projects.length === 0) {
                sel.innerHTML = '<option value="">-- 当前分类/平台下暂无工程 (请在分类或平台中切换) --</option>';
                return;
            }
            sel.innerHTML = '<option value="">-- 请选择工程项目 --</option>';
            projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                const formattedTitle = formatProjectDisplayName(p);
                const isLocked = (p.is_locked === 1 || p.is_locked === undefined);
                const lockIcon = isLocked ? '🔒 ' : '🟢 ';
                const lockedBy = (p.locked_by || '').trim();
                const lockTag = isLocked ? ' (只读)' : (lockedBy ? ` (编辑中: ${lockedBy})` : ' (编辑中)');
                const timeStr = p.updated_at ? `\n上次修改: ${p.updated_at}` : (p.created_at ? `\n创建时间: ${p.created_at}` : '');
                opt.textContent = `${lockIcon}${formattedTitle}${lockTag}`;
                opt.title = `${formattedTitle}${lockTag}${timeStr}`;
                sel.appendChild(opt);
            });
            if (selectedId) sel.value = selectedId;
        }

        function renderProjectHeaderSummary(data) {
            const summaryEl = document.getElementById('projectInfoSummary');
            if (!summaryEl) return;
            if (!data) {
                summaryEl.innerHTML = '<span style="color: var(--text-muted); font-size: 13px;">当前未载入项目</span>';
                return;
            }
            const updatedTime = data.updated_at || data.created_at || '';
            const createdTime = data.created_at || '';
            const docNo = data.doc_no || '未设';
            const ecnNo = data.ecn_no || '无';

            let timeBadgeHtml = '';
            if (updatedTime) {
                const tooltip = createdTime ? `工程创建时间: ${createdTime}\n上次修改时间: ${updatedTime}` : `上次修改时间: ${updatedTime}`;
                timeBadgeHtml = `
                    <span title="${tooltip}" style="display: inline-flex; align-items: center; gap: 5px; background: #f8fafc; border: 1px solid #cbd5e1; color: #334155; padding: 3px 9px; border-radius: 5px; font-size: 12px; cursor: help; transition: all 0.2s ease;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <span>上次修改: <b style="color: #0f172a; font-weight: 600;">${updatedTime}</b></span>
                    </span>
                `;
            }

            summaryEl.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    ${timeBadgeHtml}
                    <span style="color: #cbd5e1; font-size: 11px;">|</span>
                    <span style="color: #64748b; font-size: 12px;">文件号: <b style="color: #334155;">${docNo}</b></span>
                    <span style="color: #cbd5e1; font-size: 11px;">|</span>
                    <span style="color: #64748b; font-size: 12px;">ECN: <b style="color: #334155;">${ecnNo}</b></span>
                </div>
            `;
        }

        function refreshCurrentProjectUpdatedAt(customTime = null) {
            if (!currentProjectData) return;
            if (customTime) {
                currentProjectData.updated_at = customTime;
            } else {
                const d = new Date();
                const pad = n => String(n).padStart(2, '0');
                currentProjectData.updated_at = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            }
            renderProjectHeaderSummary(currentProjectData);
            const covUp = document.getElementById('cov-updated-at');
            if (covUp) covUp.value = currentProjectData.updated_at || '';
        }

        
// ==============================================================================
// 主界面系统分类导航器 (Main System Category Navigator)
// ==============================================================================
function renderMainCategoryNav() {
    const pillsContainer = document.getElementById('categoryNavPills');
    if (!pillsContainer) return;

    if (!allMainCategoriesCache || allMainCategoriesCache.length === 0) {
        allMainCategoriesCache = [
            { code: 'pitch', name: '变桨系统', default_system_name: '变桨系统', icon: '' },
            { code: 'converter', name: '变流器系统', default_system_name: '变流器系统', icon: '' }
        ];
    }

    const total = allMainProjectsCache.length;
    const counts = {};
    allMainProjectsCache.forEach(p => {
        const cat = (p.category || 'pitch').toLowerCase();
        counts[cat] = (counts[cat] || 0) + 1;
    });

    const hasData = (allMainProjectsCache && allMainProjectsCache.length > 0);

    let html = `
        <button type="button" class="cat-pill ${currentMainCategory === 'all' ? 'active' : ''}" onclick="switchMainCategory('all')" title="显示所有分类下的全部工程项目">
            <span>全部分类</span>
            <span class="cat-pill-count" id="catNavCount-all">${hasData ? total : (document.getElementById('catNavCount-all')?.textContent || '-')}</span>
        </button>
    `;

    (allMainCategoriesCache || []).forEach(cat => {
        const catCode = (cat.code || '').toLowerCase();
        const isActive = (currentMainCategory === catCode);
        const icon = cat.icon || '📁';
        const cnt = counts[catCode] || 0;
        const fallbackEl = document.getElementById(`catNavCount-${catCode}`);
        const countDisplay = hasData ? cnt : (fallbackEl ? fallbackEl.textContent : '-');
        html += `
            <button type="button" class="cat-pill ${isActive ? 'active' : ''}" onclick="switchMainCategory('${escapeHtml(catCode)}')" title="快速切换至【${escapeHtml(cat.name)}】分类工程视图">
                <span>${escapeHtml(cat.name)}</span>
                <span class="cat-pill-count" id="catNavCount-${escapeHtml(catCode)}">${countDisplay}</span>
            </button>
        `;
    });

    pillsContainer.innerHTML = html;
}

// ==============================================================================
// 主界面机型平台下拉选项构建 (Main Platform Options & Cascading Filter)
// ==============================================================================
function renderMainPlatformOptions() {
    const sel = document.getElementById('platformSelect');
    if (!sel) return;

    // 仅基于当前选中的大分类统计可用机型平台
    const catProjects = (currentMainCategory === 'all')
        ? allMainProjectsCache
        : allMainProjectsCache.filter(p => (p.category || 'pitch').toLowerCase() === currentMainCategory.toLowerCase());

    const platformCounts = {};
    catProjects.forEach(p => {
        const plat = (p.platform || '').trim();
        if (plat) {
            platformCounts[plat] = (platformCounts[plat] || 0) + 1;
        }
    });

    const sortedPlatforms = Object.keys(platformCounts).sort();
    const total = catProjects.length;

    // 如果当前选中的平台在当前大分类下已不存在，重置为 all
    if (currentMainPlatform !== 'all' && !platformCounts[currentMainPlatform]) {
        currentMainPlatform = 'all';
    }

    let html = `<option value="all">-- 全部平台 (${total}) --</option>`;
    sortedPlatforms.forEach(plat => {
        const cnt = platformCounts[plat] || 0;
        const isSel = (currentMainPlatform === plat) ? 'selected' : '';
        html += `<option value="${escapeHtml(plat)}" ${isSel}>${escapeHtml(plat)} (${cnt})</option>`;
    });

    sel.innerHTML = html;
    sel.value = currentMainPlatform;
}

function handlePlatformFilterChange(plat) {
    const prevPlat = currentMainPlatform;
    const nextPlat = (plat || 'all').trim();
    if (nextPlat === prevPlat) return;

    currentMainPlatform = nextPlat;
    const filtered = getMainFilteredProjects();
    const currentInFiltered = filtered.some(p => p.id == currentProjectId);

    if (!currentInFiltered && !confirmDiscardProjectChanges()) {
        currentMainPlatform = prevPlat;
        const pSel = document.getElementById('platformSelect');
        if (pSel) pSel.value = prevPlat;
        return;
    }

    if (currentInFiltered) {
        renderProjectSelectOptions(filtered, currentProjectId);
    } else {
        if (filtered.length > 0) {
            renderProjectSelectOptions(filtered, filtered[0].id);
            loadProject(filtered[0].id);
        } else {
            renderProjectSelectOptions([], null);
            closeCurrentProject(true);
            const ph = document.getElementById('noProjectPlaceholder');
            if (ph) {
                const h3 = ph.querySelector('h3');
                if (h3) h3.textContent = `当前【${currentMainPlatform}】平台下暂无工程项目`;
            }
        }
    }
}

async function switchMainCategory(catCode) {
    const prevCat = currentMainCategory;
    const nextCat = (catCode || 'all').toLowerCase();
    currentMainCategory = nextCat;

    if (!allMainProjectsCache || allMainProjectsCache.length === 0) {
        renderMainCategoryNav();
        await loadProjects();
        return;
    }

    const catFiltered = (currentMainCategory === 'all')
        ? allMainProjectsCache
        : allMainProjectsCache.filter(p => (p.category || 'pitch').toLowerCase() === currentMainCategory);
    const currentInCat = catFiltered.some(p => p.id == currentProjectId);
    if (!currentInCat && !confirmDiscardProjectChanges()) {
        currentMainCategory = prevCat;
        return;
    }

    renderMainCategoryNav();

    // 重新渲染平台选项列表（分类变动会导致所属平台集合联动变动）
    renderMainPlatformOptions();

    const filtered = getMainFilteredProjects();

    // 检查当前打开的项目是否在当前分类+平台过滤列表中
    const currentInFiltered = filtered.some(p => p.id == currentProjectId);
    if (currentInFiltered) {
        renderProjectSelectOptions(filtered, currentProjectId);
    } else {
        if (filtered.length > 0) {
            renderProjectSelectOptions(filtered, filtered[0].id);
            loadProject(filtered[0].id);
        } else {
            renderProjectSelectOptions([], null);
            closeCurrentProject(true);
            const ph = document.getElementById('noProjectPlaceholder');
            if (ph) {
                const targetCat = (allMainCategoriesCache || []).find(c => c.code === currentMainCategory);
                const catName = targetCat ? targetCat.name : currentMainCategory;
                const h3 = ph.querySelector('h3');
                if (h3) h3.textContent = `当前【${catName}】分类下暂无已打开的工程`;
            }
        }
    }
}

async function refreshProjectSelectOnly(selectedId = null) {
            try {
                const [projects, catRes] = await Promise.all([
                    safeFetchJson('/api/projects'),
                    safeFetchJson('/api/categories?all=1').catch(() => ({ categories: [] }))
                ]);
                allMainProjectsCache = Array.isArray(projects) ? projects : [];
                if (catRes && catRes.categories && catRes.categories.length > 0) {
                    allMainCategoriesCache = catRes.categories;
                }
                renderMainCategoryNav();
                renderMainPlatformOptions();
                const filtered = getMainFilteredProjects();
                renderProjectSelectOptions(filtered, selectedId || currentProjectId);
            } catch (e) {
                console.error("刷新项目列表失败", e);
            }
        }

        async function loadProjects(selectId = null, targetSubsystemId = null) {
            // 先立即渲染默认分类与平台，杜绝白屏/空白闪烁
            renderMainCategoryNav();
            renderMainPlatformOptions();
            try {
                const [projects, catRes] = await Promise.all([
                    safeFetchJson('/api/projects'),
                    safeFetchJson('/api/categories?all=1').catch(() => ({ categories: [] }))
                ]);
                allMainProjectsCache = Array.isArray(projects) ? projects : [];
                if (catRes && catRes.categories && catRes.categories.length > 0) {
                    allMainCategoriesCache = catRes.categories;
                }

                renderMainCategoryNav();
                renderMainPlatformOptions();

                const filtered = getMainFilteredProjects();

                renderProjectSelectOptions(filtered, selectId);

                if (selectId === 'none') {
                    closeCurrentProject();
                } else if (selectId && allMainProjectsCache.some(p => p.id == selectId)) {
                    const sel = document.getElementById('projectSelect');
                    if (sel) sel.value = selectId;
                    loadProject(selectId, targetSubsystemId);
                } else if (filtered.length > 0) {
                    const targetId = filtered[0].id;
                    const sel = document.getElementById('projectSelect');
                    if (sel) sel.value = targetId;
                    loadProject(targetId, targetSubsystemId);
                } else if (allMainProjectsCache.length > 0 && currentMainCategory === 'all') {
                    const targetId = allMainProjectsCache[0].id;
                    const sel = document.getElementById('projectSelect');
                    if (sel) sel.value = targetId;
                    loadProject(targetId, targetSubsystemId);
                } else {
                    closeCurrentProject();
                }
            } catch (err) {
                console.error("加载项目数据失败", err);
            }
        }

        function loadProject(projectId, targetSubsystemId = null) {
            if (!projectId) {
                closeCurrentProject();
                return;
            }
            currentProjectId = projectId;
            const contentArea = document.getElementById('projectContentArea');
            const placeholder = document.getElementById('noProjectPlaceholder');
            if (contentArea) contentArea.style.display = 'flex';
            if (placeholder) placeholder.style.display = 'none';
            setProjectActionButtonsDisabled(false);

            safeFetchJson(`/api/project/${projectId}`)
                .then(data => {
                    if (!data || data.error) {
                        closeCurrentProject();
                        return;
                    }
                    currentProjectData = data;
                    renderProjectHeaderSummary(data);

                    // 自动对齐主界面系统分类导航器与机型平台高亮状态
                    let needRefilter = false;
                    if (data.category && currentMainCategory !== 'all' && currentMainCategory !== data.category.toLowerCase()) {
                        currentMainCategory = data.category.toLowerCase();
                        renderMainCategoryNav();
                        needRefilter = true;
                    }
                    if (data.platform && currentMainPlatform !== 'all' && currentMainPlatform !== data.platform.trim()) {
                        currentMainPlatform = data.platform.trim();
                        needRefilter = true;
                    }
                    if (needRefilter) {
                        renderMainPlatformOptions();
                        const filtered = getMainFilteredProjects();
                        renderProjectSelectOptions(filtered, projectId);
                    }
                    
                    // Fill cover form
                    document.getElementById('cov-code').value = data.code || '';
                    if (document.getElementById('cov-platform')) document.getElementById('cov-platform').value = data.platform || '';
                    if (document.getElementById('cov-supplier')) document.getElementById('cov-supplier').value = data.supplier || '';
                    if (document.getElementById('cov-model')) document.getElementById('cov-model').value = data.model || '';
                    document.getElementById('cov-name').value = data.name || '风力发电机组';
                    document.getElementById('cov-system').value = data.system_name || '';
                    document.getElementById('cov-doc').value = data.doc_no || '';
                    document.getElementById('cov-ecn').value = data.ecn_no || '';
                    document.getElementById('cov-form').value = data.form_no || '';
                    document.getElementById('cov-company').value = data.company || '';
                    if (document.getElementById('cov-created-at')) {
                        document.getElementById('cov-created-at').value = data.created_at || '未记录';
                    }
                    if (document.getElementById('cov-updated-at')) {
                        document.getElementById('cov-updated-at').value = data.updated_at || data.created_at || '未记录';
                    }
                    updateCoverTitlePreview();

                    // Apply project lock state to UI
                    applyProjectLockUI(data.is_locked == 1);
                    setProjectDirty(false);
                    renderRevisionPage();

                    // Render Subsystem Tabs
                    const tabContainer = document.getElementById('subsystemTabContainer');
                    tabContainer.innerHTML = '';
                    if (data.subsystems && data.subsystems.length > 0) {
                        let activeId = (typeof targetSubsystemId === 'number' || (targetSubsystemId && targetSubsystemId !== 'cover' && targetSubsystemId !== 'revision')) ? targetSubsystemId : null;
                        if (!activeId || !data.subsystems.some(s => s.id === activeId)) {
                            activeId = data.subsystems[0].id;
                        }
                        data.subsystems.forEach((sub) => {
                            const btn = document.createElement('button');
                            btn.className = `tab-btn ${sub.id === activeId && targetSubsystemId !== 'cover' && targetSubsystemId !== 'revision' ? 'active' : ''}`;
                            btn.id = `sub-tab-${sub.id}`;
                            btn.textContent = sub.name;
                            btn.onclick = () => switchSubsystemTab(sub.id);
                            tabContainer.appendChild(btn);
                        });

                        if (targetSubsystemId === 'cover') {
                            switchTab('cover');
                        } else if (targetSubsystemId === 'revision') {
                            switchTab('revision');
                        } else {
                            switchSubsystemTab(activeId);
                        }
                    } else {
                        switchTab('cover');
                    }
                })
                .catch(err => {
                    console.error('Failed to load project:', err);
                    closeCurrentProject();
                });
        }

        function closeCurrentProject(forceClose = false) {
            if (!forceClose && !confirmDiscardProjectChanges()) {
                return;
            }
            setProjectDirty(false);
            clearRowSelection();
            currentProjectId = null;
            currentProjectData = null;
            currentSubsystemId = null;
            currentBomItems = [];
            const sel = document.getElementById('projectSelect');
            if (sel) sel.value = '';
            renderProjectHeaderSummary(null);
            if (document.getElementById('cov-created-at')) document.getElementById('cov-created-at').value = '';
            if (document.getElementById('cov-updated-at')) document.getElementById('cov-updated-at').value = '';
            const contentArea = document.getElementById('projectContentArea');
            const placeholder = document.getElementById('noProjectPlaceholder');
            if (contentArea) contentArea.style.display = 'none';
            if (placeholder) placeholder.style.display = 'block';

            const badge = document.getElementById('projectLockBadge');
            const btn = document.getElementById('btnToggleProjectLock');
            const alertBanner = document.getElementById('projectLockedAlert');
            if (badge) badge.style.display = 'none';
            if (btn) btn.style.display = 'none';
            if (alertBanner) alertBanner.style.display = 'none';
            if (document.getElementById('tabContent-revision')) document.getElementById('tabContent-revision').style.display = 'none';

            setProjectActionButtonsDisabled(true);
            showToast('已关闭当前工程项目', 'info');
        }

        // ==========================================
        // Project Lock & Unlock UI & Actions
        // ==========================================
        function applyProjectLockUI(isLocked) {
            const btn = document.getElementById('btnToggleProjectLock');
            const alertBanner = document.getElementById('projectLockedAlert');
            const alertText = document.getElementById('projectLockedAlertText');
            const btnForce = document.getElementById('btnForceTakeoverBanner');

            const lockedBy = (currentProjectData && currentProjectData.locked_by) || '';

            if (btn) {
                btn.style.display = 'inline-flex';
                btn.style.alignItems = 'center';
                btn.style.gap = '5px';
                if (isLocked) {
                    btn.className = 'btn btn-sm';
                    btn.style.background = '#fef2f2';
                    btn.style.color = '#dc2626';
                    btn.style.border = '1px solid #fca5a5';
                    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><span>已锁定 (点击解锁)</span>`;
                    btn.title = '当前工程处于锁定保护状态（只读）。点击可解锁并开启编辑';
                } else {
                    btn.className = 'btn btn-sm';
                    btn.style.background = '#f0fdf4';
                    btn.style.color = '#166534';
                    btn.style.border = '1px solid #86efac';
                    const byText = lockedBy ? `[${escapeHtml(lockedBy)}] ` : '';
                    btn.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#16a34a;"></span><span>${byText}编辑中 (点击锁定)</span>`;
                    btn.title = `当前工程处于编辑状态（占用人：${lockedBy || '当前用户'}）。点击可立即锁定保护防误改`;
                }
            }

            if (alertBanner) {
                alertBanner.style.display = isLocked ? 'inline-flex' : 'none';
                if (alertText) {
                    if (lockedBy) {
                        alertText.innerHTML = `当前工程处于<b>只读锁定保护状态</b> (占用人: <b>${escapeHtml(lockedBy)}</b>)，如需编辑请先解锁`;
                    } else {
                        alertText.innerHTML = `当前工程处于<b>只读锁定保护状态</b>，如需编辑请先解锁`;
                    }
                }
                if (btnForce) {
                    btnForce.style.display = 'none';
                }
            }

            // Toolbar add buttons
            const btnAdd = document.getElementById('btnRowAdd');
            const btnBatch = document.getElementById('btnRowBatchAdd');
            const btnAddSheet = document.getElementById('btnAddNewSheet');
            if (btnAdd) {
                btnAdd.disabled = isLocked;
                btnAdd.title = isLocked ? '当前工程已锁定，请先解锁后再添加物料' : '添加单项物料';
            }
            if (btnBatch) {
                btnBatch.disabled = isLocked;
                btnBatch.title = isLocked ? '当前工程已锁定，请先解锁后再批量导入物料' : '批量粘贴物料号添加';
            }
            if (btnAddSheet) {
                btnAddSheet.disabled = isLocked;
                btnAddSheet.title = isLocked ? '当前工程已锁定，请先解锁后再添加Sheet' : '新增子系统Sheet';
            }

            // Cover Form inputs and save button
            ['cov-code', 'cov-platform', 'cov-supplier', 'cov-system', 'cov-model', 'cov-name', 'cov-doc', 'cov-ecn', 'cov-company'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.disabled = isLocked;
            });
            const btnSaveCover = document.getElementById('btnSaveCover');
            if (btnSaveCover) {
                btnSaveCover.disabled = isLocked;
                btnSaveCover.title = isLocked ? '当前工程已锁定，请先解锁后再保存封面' : '保存封面信息';
            }
            const btnProjSave = document.getElementById('btnProjectSave');
            if (btnProjSave) {
                btnProjSave.disabled = isLocked;
                btnProjSave.title = isLocked ? '当前工程已锁定，需先解锁方可保存修改' : '将当前项目的所有修改保存到数据库';
            }

            // Revision & Signatures controls
            const btnAddEcn = document.getElementById('btnAddEcnRow');
            if (btnAddEcn) {
                btnAddEcn.disabled = isLocked;
                btnAddEcn.title = isLocked ? '当前工程已锁定，请先解锁后再添加修改记录' : '新增工程变更记录';
            }
            const btnSaveSig = document.getElementById('btnSaveSignatures');
            if (btnSaveSig) {
                btnSaveSig.disabled = isLocked;
                btnSaveSig.title = isLocked ? '当前工程已锁定，请先解锁后再保存签字' : '保存签字信息';
            }
            ['sig-author-name', 'sig-author-date', 'sig-reviewer-name', 'sig-reviewer-date', 'sig-approver-name', 'sig-approver-date'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.disabled = isLocked;
            });
            renderRevisionPage();

            // Project Rename / Delete buttons
            const btnRename = document.getElementById('btnProjectRename');
            const btnDelete = document.getElementById('btnProjectDelete');
            if (btnRename) {
                btnRename.title = isLocked ? '当前工程已锁定，需先解锁方可重命名' : '重命名当前项目的工程名称';
            }
            if (btnDelete) {
                btnDelete.title = isLocked ? '当前工程已锁定，需先解锁方可删除' : '删除当前项目及其所有Sheet与BOM数据';
            }

            // Sheet Operations buttons
            const btnCopySheet = document.getElementById('btnCopySheet');
            const btnDeleteSheet = document.getElementById('btnDeleteSheet');
            if (btnCopySheet) {
                btnCopySheet.disabled = isLocked;
                btnCopySheet.title = isLocked ? '当前工程已锁定，需先解锁方可复制Sheet' : '完整复制当前Sheet及其所有BOM物料明细行';
            }
            if (btnDeleteSheet) {
                btnDeleteSheet.disabled = isLocked;
                btnDeleteSheet.title = isLocked ? '当前工程已锁定，需先解锁方可删除Sheet' : '删除当前Sheet及其所有物料';
            }

            // Update row action buttons
            updateRowActionButtons();

            if (isLocked) {
                stopProjectHeartbeat();
            } else {
                startProjectHeartbeat();
            }
        }

        // ================= 局域网工程锁心跳租约 =================
        let projectHeartbeatTimer = null;

        function startProjectHeartbeat() {
            stopProjectHeartbeat();
            if (!currentProjectId) return;
            projectHeartbeatTimer = setInterval(async () => {
                if (!currentProjectId || !currentProjectData || currentProjectData.is_locked == 1) {
                    stopProjectHeartbeat();
                    return;
                }
                try {
                    const res = await safeFetchJson(`/api/project/${currentProjectId}/heartbeat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (res && res.taken_over) {
                        stopProjectHeartbeat();
                        currentProjectData.is_locked = 1;
                        currentProjectData.locked_by = res.locked_by || '';
                        applyProjectLockUI(true);
                        refreshProjectSelectOnly(currentProjectId);
                        showToast(`当前工程编辑权已被 [${res.locked_by || '其他终端'}] 接管，已自动切换为只读保护状态！`, 'warning');
                    }
                } catch (e) {
                    // 心跳异常静默重试
                }
            }, 30000);
        }

        function stopProjectHeartbeat() {
            if (projectHeartbeatTimer) {
                clearInterval(projectHeartbeatTimer);
                projectHeartbeatTimer = null;
            }
        }

        // 未保存修改离开提示 & 实际离开页面时释放锁
        window.addEventListener('beforeunload', (e) => {
            if (isProjectMetadataDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        window.addEventListener('pagehide', () => {
            if (currentProjectId && currentProjectData && currentProjectData.is_locked == 0) {
                stopProjectHeartbeat();
                try {
                    navigator.sendBeacon(`/api/project/${currentProjectId}/lock`);
                } catch (e) {}
            }
        });

        async function unlockCurrentProject(force = false) {
            if (!currentProjectId || !currentProjectData) return;
            const pTitle = formatProjectDisplayName(currentProjectData) || '当前工程';

            if (!force) {
                if (!confirm(`确认解锁工程【${pTitle}】以进行编辑？\n\n（独立工程锁机制：解锁本工程不会影响其他同事正在编辑的其他机型）`)) {
                    return;
                }
            }


            try {
                const res = await safeFetchJson(`/api/project/${currentProjectId}/unlock`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        force: force
                    })
                });
                if (res && res.success) {
                    currentProjectData.is_locked = 0;
                    currentProjectData.locked_by = res.locked_by || '';
                    showToast(res.message || `工程【${pTitle}】已解锁！`, 'success');
                    applyProjectLockUI(false);
                    refreshProjectSelectOnly(currentProjectId);
                } else {
                    alert((res && res.error) || '解锁失败');
                }
            } catch (err) {
                if (err.data && err.data.need_confirm) {
                    const btnForce = document.getElementById('btnForceTakeoverBanner');
                    if (btnForce) btnForce.style.display = 'inline-block';
                    if (confirm(`${err.data.error}`)) {
                        unlockCurrentProject(true);
                    }
                } else {
                    alert('解锁过程发生错误: ' + err.message);
                }
            }
        }

        async function lockCurrentProject() {
            if (!currentProjectId || !currentProjectData) return;
            const pTitle = formatProjectDisplayName(currentProjectData) || '当前工程';

            try {
                const res = await safeFetchJson(`/api/project/${currentProjectId}/lock`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (res && res.success) {
                    stopProjectHeartbeat();
                    currentProjectData.is_locked = 1;
                    currentProjectData.locked_by = '';
                    showToast(`工程【${pTitle}】已锁定保护！`, 'info');
                    applyProjectLockUI(true);
                    refreshProjectSelectOnly(currentProjectId);
                } else {
                    alert((res && res.error) || '锁定失败');
                }
            } catch (err) {
                alert('锁定过程发生错误: ' + err.message);
            }
        }


        function toggleCurrentProjectLock() {
            if (!currentProjectData) return;
            if (currentProjectData.is_locked == 1) {
                unlockCurrentProject();
            } else {
                lockCurrentProject();
            }
        }

        function deleteCurrentProject() {
            if (!currentProjectId || !currentProjectData) {
                alert('当前未打开任何工程项目，无法执行删除！');
                return;
            }
            if (currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法删除！如需删除请先在顶部点击【解锁编辑】。');
                return;
            }
            const projTitle = formatProjectDisplayName(currentProjectData) || '当前项目';
            const confirmMsg = `确定要彻底删除项目【${projTitle}】吗？\n\n删除后：\n1. 该项目的所有子系统 Sheet 将被永久移除；\n2. 该项目的所有 BOM 编制明细行将被永久清除；\n3. 全局通用物料主库将完整保留，不受影响。\n\n此操作不可撤销，确定删除吗？`;
            if (!confirm(confirmMsg)) return;

            safeFetchJson('/api/project/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: currentProjectId })
            })
            .then(res => {
                if (res.success) {
                    showToast(res.message || '项目已成功删除。', 'success');
                    loadProjects();
                } else {
                    alert(res.error || '删除项目失败');
                }
            })
            .catch(err => alert('删除操作异常: ' + err.message));
        }

        function setProjectActionButtonsDisabled(disabled) {
            ['btnProjectSave', 'btnProjectCopy', 'btnProjectRename', 'btnProjectClose', 'btnProjectDelete', 'btnHeaderSave', 'btnHeaderExport', 'btnHeaderOfflinePkg', 'btnHeaderClose'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.disabled = disabled;
                    if (disabled) {
                        el.style.opacity = '0.45';
                        el.style.pointerEvents = 'none';
                        el.setAttribute('tabindex', '-1');
                    } else {
                        el.style.opacity = '1';
                        el.style.pointerEvents = 'auto';
                        el.removeAttribute('tabindex');
                    }
                }
            });
        }


        // --- Save Current Project to Database ---
        async function saveCurrentProjectToDatabase() {
            if (!currentProjectId) {
                alert('请先选择或打开一个工程项目！');
                return;
            }
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法保存修改！如需编辑请先在顶部点击【解锁编辑】。');
                return;
            }

            const btnSave = document.getElementById('btnProjectSave');
            const originalText = btnSave ? btnSave.innerHTML : '保存';
            if (btnSave) {
                btnSave.disabled = true;
                btnSave.textContent = '保存中...';
            }

            try {
                // 1. 提取当前封面表单最新值（若页面未显示该元素则回退为缓存数据）
                const codeEl = document.getElementById('cov-code');
                const platformEl = document.getElementById('cov-platform');
                const supplierEl = document.getElementById('cov-supplier');
                const modelEl = document.getElementById('cov-model');
                const nameEl = document.getElementById('cov-name');
                const systemEl = document.getElementById('cov-system');
                const docEl = document.getElementById('cov-doc');
                const ecnEl = document.getElementById('cov-ecn');
                const formEl = document.getElementById('cov-form');
                const companyEl = document.getElementById('cov-company');

                const payload = {
                    id: currentProjectId,
                    code: codeEl ? codeEl.value.trim() : (currentProjectData.code || ''),
                    platform: platformEl ? platformEl.value.trim() : (currentProjectData.platform || ''),
                    supplier: supplierEl ? supplierEl.value.trim() : (currentProjectData.supplier || ''),
                    model: modelEl ? modelEl.value.trim() : (currentProjectData.model || ''),
                    name: (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : (nameEl ? '' : (currentProjectData.name || '风力发电机组')),
                    system_name: systemEl ? systemEl.value.trim() : (currentProjectData.system_name || ''),

                    category: (currentProjectData.category || 'pitch'),
                    doc_no: docEl ? docEl.value.trim() : (currentProjectData.doc_no || ''),
                    ecn_no: ecnEl ? ecnEl.value.trim() : (currentProjectData.ecn_no || ''),
                    form_no: (formEl && formEl.value.trim()) ? formEl.value.trim() : (formEl ? '' : (currentProjectData.form_no || 'FDJL-JS-037')),
                    company: (companyEl && companyEl.value.trim()) ? companyEl.value.trim() : (companyEl ? '' : (currentProjectData.company || '上海电气风电集团股份有限公司'))
                };

                const res = await safeFetchJson('/api/project/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!res || !res.success) {
                    alert((res && res.error) || '保存项目失败');
                    return;
                }

                // 2. 如果页面有签字字段，同步保存 6 级签字
                const sigAuthor = document.getElementById('sig-author-name');
                if (sigAuthor) {
                    const getSigVal = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');
                    const signatures = [
                        { role: '编制', sign_name: getSigVal('sig-author-name'), sign_date: getSigVal('sig-author-date') },
                        { role: '校对', sign_name: getSigVal('sig-reviewer-name'), sign_date: getSigVal('sig-reviewer-date') },
                        { role: '审核', sign_name: getSigVal('sig-checker-name'), sign_date: getSigVal('sig-checker-date') },
                        { role: '会签', sign_name: getSigVal('sig-countersign-name'), sign_date: getSigVal('sig-countersign-date') },
                        { role: '标审', sign_name: getSigVal('sig-standard-name'), sign_date: getSigVal('sig-standard-date') },
                        { role: '审定', sign_name: getSigVal('sig-approver-name'), sign_date: getSigVal('sig-approver-date') }
                    ];
                    try {
                        await safeFetchJson(`/api/project/${currentProjectId}/signatures/save`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ signatures })
                        });
                        if (currentProjectData) {
                            currentProjectData.signatures = signatures;
                        }
                    } catch (e) {
                        console.warn('Auto saving signatures error:', e);
                    }
                }

                // 3. 更新内存数据与头部信息
                if (currentProjectData) {
                    Object.assign(currentProjectData, payload);
                    if (res) {
                        if (res.updated_at) currentProjectData.updated_at = res.updated_at;
                        if (res.created_at) currentProjectData.created_at = res.created_at;
                    }
                }
                renderProjectHeaderSummary(currentProjectData);
                const covUp = document.getElementById('cov-updated-at');
                if (covUp && currentProjectData) covUp.value = currentProjectData.updated_at || '';
                refreshProjectSelectOnly(currentProjectId);
                updateCoverTitlePreview();

                // 4. 成功提示
                setProjectDirty(false);
                showToast('项目所有修改已成功保存至数据库！', 'success');
            } catch (err) {
                alert('保存项目失败: ' + (err.message || '网络连接异常'));
            } finally {
                if (btnSave) {
                    btnSave.disabled = false;
                    btnSave.innerHTML = originalText;
                }
            }
        }

        // --- Save Project Cover (封面内保存按钮复用) ---
        async function saveProjectCover() {
            await saveCurrentProjectToDatabase();
        }

        // --- 实时更新封面与 BOM 页名称预览 ---
        function updateCoverTitlePreview() {
            const platEl = document.getElementById('cov-platform');
            const codeEl = document.getElementById('cov-code');
            const suppEl = document.getElementById('cov-supplier');
            const sysEl = document.getElementById('cov-system');
            const modEl = document.getElementById('cov-model');

            const platform = platEl ? platEl.value.trim() : '';
            const code = codeEl ? codeEl.value.trim() : '';
            const supplier = suppEl ? suppEl.value.trim() : '';
            let system = sysEl ? sysEl.value.trim() : '';
            let model = modEl ? modEl.value.trim() : '';

            if (!model && typeof currentProjectData !== 'undefined' && currentProjectData) {
                model = currentProjectData.model || currentProjectData.root_model || '';
            }

            const partName = cleanSubsystemPartName(system, supplier, code, platform, model);
            const modelSuffix = model ? `_${model}` : '';
            const coverTitle = `${supplier}${partName}SBOM${modelSuffix}`;

            const prefixPlatCode = code || platform || 'EW-DEFAULT';
            const bomTitle = `${prefixPlatCode}${supplier}${partName}SBOM${modelSuffix}`;

            const prevCov = document.getElementById('cov-preview-cover');
            const prevBom = document.getElementById('cov-preview-bom');
            if (prevCov) prevCov.textContent = coverTitle;
            if (prevBom) prevBom.textContent = bomTitle;
        }

        // ==========================================
        // Revision & Signatures (清单签字及修改页) Logic
        // ==========================================
        function renderRevisionPage() {
            if (!currentProjectData) return;
            const ecnList = currentProjectData.ecn_records || [];
            const sigList = currentProjectData.signatures || [];
            const isLocked = currentProjectData.is_locked == 1;

            // 1. Render Signatures (6 roles for V2 签字页)
            const sigMap = {};
            sigList.forEach(s => {
                if (s.role) sigMap[s.role] = s;
            });
            const author = sigMap['编制'] || {};
            const reviewer = sigMap['校对'] || sigMap['校核'] || {};
            const checker = sigMap['审核'] || {};
            const countersign = sigMap['会签'] || {};
            const standard = sigMap['标审'] || {};
            const approver = sigMap['审定'] || {};

            const setSigVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val || '';
            };
            setSigVal('sig-author-name', author.sign_name);
            setSigVal('sig-author-date', author.sign_date);
            setSigVal('sig-reviewer-name', reviewer.sign_name);
            setSigVal('sig-reviewer-date', reviewer.sign_date);
            setSigVal('sig-checker-name', checker.sign_name);
            setSigVal('sig-checker-date', checker.sign_date);
            setSigVal('sig-countersign-name', countersign.sign_name);
            setSigVal('sig-countersign-date', countersign.sign_date);
            setSigVal('sig-standard-name', standard.sign_name);
            setSigVal('sig-standard-date', standard.sign_date);
            setSigVal('sig-approver-name', approver.sign_name);
            setSigVal('sig-approver-date', approver.sign_date);

            // 2. Render ECN Records Table (7 columns for V2 更改页)
            const tbody = document.getElementById('ecnTableBody');
            if (!tbody) return;

            let html = '';
            if (ecnList.length === 0) {
                html += `
                    <tr>
                        <td colspan="7" style="text-align: center; padding: 36px 12px; color: #94a3b8; font-size: 13px;">
                            <div style="font-size: 26px; margin-bottom: 6px;">📋</div>
                            暂无工程变更修改记录。<br>
                            ${isLocked ? '<span style="color: #ef4444; font-size: 12px; margin-top: 4px; display: inline-block;">当前工程处于锁定保护状态，如需添加请先在顶部点击【已锁定】进行解锁</span>' : '<span style="color: #2563eb; font-size: 12px; cursor: pointer; text-decoration: underline; margin-top: 4px; display: inline-block;" onclick="openAddEcnModal()">➕ 点击添加第一条修改记录</span>'}
                        </td>
                    </tr>
                `;
            } else {
                ecnList.forEach((ecn, idx) => {
                    const rowNo = idx + 1;
                    const ecnNoSafe = escapeHtml(ecn.ecn_no || '');
                    const changePosSafe = escapeHtml(ecn.change_pos || '');
                    const descSafe = escapeHtml(ecn.change_desc || '');
                    const changerSafe = escapeHtml(ecn.changer || '');
                    const dateSafe = escapeHtml(ecn.change_date || '');

                    html += `
                        <tr style="border-bottom: 1px solid #e2e8f0; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                            <td style="text-align: center; padding: 12px 8px; font-weight: 600; color: #64748b; border-right: 1px solid #e2e8f0;">${rowNo}</td>
                            <td style="padding: 12px 10px; font-weight: 600; color: #1e293b; border-right: 1px solid #e2e8f0;">
                                <span style="background: #eff6ff; color: #1d4ed8; padding: 3px 8px; border-radius: 4px; font-size: 12px; border: 1px solid #bfdbfe; font-family: monospace;">
                                    ${ecnNoSafe || '—'}
                                </span>
                            </td>
                            <td style="padding: 12px 10px; color: #475569; font-weight: 500; border-right: 1px solid #e2e8f0;">${changePosSafe || '—'}</td>
                            <td style="padding: 12px 14px; color: #334155; line-height: 1.6; white-space: pre-wrap; word-break: break-word; border-right: 1px solid #e2e8f0;">${descSafe || '—'}</td>
                            <td style="padding: 12px 10px; color: #475569; font-weight: 500; border-right: 1px solid #e2e8f0;">${changerSafe || '—'}</td>
                            <td style="padding: 12px 10px; color: #64748b; border-right: 1px solid #e2e8f0; font-family: monospace;">${dateSafe || '—'}</td>
                            <td style="text-align: center; padding: 12px 8px;">
                                <div style="display: inline-flex; gap: 6px; justify-content: center;">
                                    <button type="button" class="btn btn-outline btn-sm" onclick="openEditEcnModal(${idx})" ${isLocked ? 'disabled' : ''} style="padding: 3px 8px; font-size: 12px;" title="编辑此条修改记录">
                                        ✏️ 编辑
                                    </button>
                                    <button type="button" class="btn btn-outline btn-sm" onclick="deleteEcnRecord(${ecn.id})" ${isLocked ? 'disabled' : ''} style="padding: 3px 8px; font-size: 12px; color: #ef4444; border-color: #fca5a5;" title="删除此条修改记录">
                                        🗑️ 删除
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                });

                if (!isLocked) {
                    html += `
                        <tr style="background: #fafafa; border-top: 1px dashed #cbd5e1; cursor: pointer;" onclick="openAddEcnModal()" title="点击在此追加填入下一行修改记录">
                            <td colspan="7" style="text-align: center; padding: 10px; color: #2563eb; font-size: 13px; font-weight: 500;">
                                ➕ 点击在此添加下一行修改记录...
                            </td>
                        </tr>
                    `;
                }
            }
            tbody.innerHTML = html;
        }

        function openAddEcnModal() {
            if (!currentProjectId) {
                alert('请先选择或打开一个工程项目！');
                return;
            }
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法添加修改记录！如需编辑请先在顶部点击【解锁】。');
                return;
            }

            document.getElementById('ecnModalTitle').textContent = '➕ 新增修改记录';
            document.getElementById('ecnModalRecordId').value = '';

            const projEcn = (currentProjectData && currentProjectData.ecn_no) || '';
            document.getElementById('ecnModalEcnNo').value = projEcn;
            document.getElementById('ecnModalChangePos').value = '';

            let defaultChanger = '';
            if (currentProjectData && currentProjectData.ecn_records && currentProjectData.ecn_records.length > 0) {
                defaultChanger = currentProjectData.ecn_records[currentProjectData.ecn_records.length - 1].changer || '';
            } else if (currentProjectData && currentProjectData.signatures) {
                const sAuthor = currentProjectData.signatures.find(s => s.role === '编制');
                if (sAuthor) defaultChanger = sAuthor.sign_name || '';
            }
            document.getElementById('ecnModalChanger').value = defaultChanger;

            const today = new Date().toISOString().split('T')[0];
            document.getElementById('ecnModalChangeDate').value = today;
            document.getElementById('ecnModalChangeDesc').value = '';

            openModal('ecnModal');
            setTimeout(() => {
                const descInput = document.getElementById('ecnModalChangeDesc');
                if (descInput) descInput.focus();
            }, 100);
        }

        function openEditEcnModal(index) {
            if (!currentProjectId || !currentProjectData || !currentProjectData.ecn_records) return;
            if (currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法编辑修改记录！');
                return;
            }
            const record = currentProjectData.ecn_records[index];
            if (!record) return;

            document.getElementById('ecnModalTitle').textContent = '✏️ 编辑修改记录';
            document.getElementById('ecnModalRecordId').value = record.id;
            document.getElementById('ecnModalEcnNo').value = record.ecn_no || '';
            document.getElementById('ecnModalChangePos').value = record.change_pos || '';
            document.getElementById('ecnModalChanger').value = record.changer || '';
            document.getElementById('ecnModalChangeDate').value = record.change_date || '';
            document.getElementById('ecnModalChangeDesc').value = record.change_desc || '';

            openModal('ecnModal');
        }

        function closeEcnModal() {
            closeModal('ecnModal');
        }

        async function submitEcnModal() {
            if (!currentProjectId) return;
            const recordId = document.getElementById('ecnModalRecordId').value;
            const ecnNo = document.getElementById('ecnModalEcnNo').value.trim();
            const changePos = (document.getElementById('ecnModalChangePos').value || '').trim();
            const changer = document.getElementById('ecnModalChanger').value.trim();
            const changeDate = document.getElementById('ecnModalChangeDate').value.trim();
            const changeDesc = document.getElementById('ecnModalChangeDesc').value.trim();

            if (!ecnNo && !changeDesc) {
                alert('请至少填写 ECN 号或更改内容描述！');
                return;
            }

            const payload = {
                ecn_no: ecnNo,
                change_pos: changePos,
                changer: changer,
                change_date: changeDate,
                change_desc: changeDesc
            };

            const btnSave = document.getElementById('btnSaveEcnRecord');
            btnSave.disabled = true;
            btnSave.textContent = '保存中...';

            try {
                if (recordId) {
                    const res = await safeFetchJson(`/api/project/${currentProjectId}/ecn/${recordId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (res && res.success) {
                        showToast('修改记录已更新！', 'success');
                        closeEcnModal();
                        const idx = currentProjectData.ecn_records.findIndex(r => r.id == recordId);
                        if (idx !== -1) {
                            currentProjectData.ecn_records[idx] = { ...currentProjectData.ecn_records[idx], ...payload };
                        }
                        renderRevisionPage();
                        refreshCurrentProjectUpdatedAt();
                    } else {
                        alert((res && res.error) || '更新记录失败');
                    }
                } else {
                    const res = await safeFetchJson(`/api/project/${currentProjectId}/ecn`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (res && res.success) {
                        showToast('新增修改记录成功！填入下一行', 'success');
                        closeEcnModal();
                        if (!currentProjectData.ecn_records) currentProjectData.ecn_records = [];
                        currentProjectData.ecn_records.push(res.record);
                        renderRevisionPage();
                        refreshCurrentProjectUpdatedAt();
                    } else {
                        alert((res && res.error) || '新增记录失败');
                    }
                }
            } catch (err) {
                alert('操作失败: ' + err.message);
            } finally {
                btnSave.disabled = false;
                btnSave.textContent = '保存记录';
            }
        }

        async function deleteEcnRecord(recordId) {
            if (!currentProjectId || !currentProjectData) return;
            if (currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法删除修改记录！');
                return;
            }
            if (!confirm('确认删除该条修改记录吗？此操作无法撤销。')) return;

            try {
                const res = await safeFetchJson(`/api/project/${currentProjectId}/ecn/${recordId}`, {
                    method: 'DELETE'
                });
                if (res && res.success) {
                    showToast('修改记录已删除', 'info');
                    currentProjectData.ecn_records = currentProjectData.ecn_records.filter(r => r.id != recordId);
                    renderRevisionPage();
                    refreshCurrentProjectUpdatedAt();
                } else {
                    alert((res && res.error) || '删除失败');
                }
            } catch (err) {
                alert('删除失败: ' + err.message);
            }
        }

        async function saveProjectSignatures() {
            if (!currentProjectId || !currentProjectData) return;
            if (currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法修改签字信息！如需编辑请先在顶部点击【解锁】。');
                return;
            }

            const getSigVal = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');

            const signatures = [
                { role: '编制', sign_name: getSigVal('sig-author-name'), sign_date: getSigVal('sig-author-date') },
                { role: '校对', sign_name: getSigVal('sig-reviewer-name'), sign_date: getSigVal('sig-reviewer-date') },
                { role: '审核', sign_name: getSigVal('sig-checker-name'), sign_date: getSigVal('sig-checker-date') },
                { role: '会签', sign_name: getSigVal('sig-countersign-name'), sign_date: getSigVal('sig-countersign-date') },
                { role: '标审', sign_name: getSigVal('sig-standard-name'), sign_date: getSigVal('sig-standard-date') },
                { role: '审定', sign_name: getSigVal('sig-approver-name'), sign_date: getSigVal('sig-approver-date') }
            ];

            const btnSave = document.getElementById('btnSaveSignatures');
            btnSave.disabled = true;
            btnSave.textContent = '保存中...';

            try {
                const res = await safeFetchJson(`/api/project/${currentProjectId}/signatures/save`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ signatures })
                });
                if (res && res.success) {
                    showToast('签字审核信息保存成功！', 'success');
                    currentProjectData.signatures = signatures;
                    refreshCurrentProjectUpdatedAt();
                } else {
                    alert((res && res.error) || '保存签字失败');
                }
            } catch (err) {
                alert('保存签字失败: ' + err.message);
            } finally {
                btnSave.disabled = false;
                btnSave.textContent = '💾 保存签字';
            }
        }


        // --- Import Excel ---
        function openImportModal() {
            document.getElementById('importProgress').style.display = 'none';
            openModal('importModal');
        }

        function submitImportExcel() {
            const fileInput = document.getElementById('excelFileInput');
            if (fileInput.files.length === 0) {
                alert('请先选择要导入的 .xlsx 文件！');
                return;
            }
            document.getElementById('importProgress').style.display = 'block';
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);

            safeFetchJson('/api/import', { method: 'POST', body: formData })
                .then(res => {
                    document.getElementById('importProgress').style.display = 'none';
                    if (res && res.success) {
                        alert('Excel 模版解析并导入成功！');
                        closeModal('importModal');
                        loadProjects();
                    } else {
                        alert((res && res.error) || '导入失败');
                    }
                })
                .catch(err => {
                    document.getElementById('importProgress').style.display = 'none';
                    alert(err.message || '导入失败');
                });
        }

        // --- Export Deliverables Options (Option 1 vs Option 2) ---
        let currentSelectedExportOption = 1;

        function exportCurrentProject() {
            if (!currentProjectId) {
                showToast('请先选择或载入工程项目！', 'warning');
                return;
            }
            // Populate project title in modal
            const nameEl = document.getElementById('export-modal-project-name');
            if (nameEl) {
                let projTitle = currentProjectData ? formatProjectDisplayName(currentProjectData) : '当前工程项目';
                nameEl.textContent = projTitle || `项目 #${currentProjectId}`;
            }
            // Linux 服务端环境自适应检测
            if (window.IS_WINDOWS_SERVER === false) {
                const card2 = document.getElementById('exportCardOption2');
                const winTag = document.getElementById('exportOption2WinTag');
                const btn2 = document.getElementById('btnExportOption2');
                if (winTag) {
                    winTag.textContent = 'Linux 服务端不支持';
                    winTag.style.background = '#fee2e2';
                    winTag.style.color = '#b91c1c';
                    winTag.title = '服务端运行在 Linux 环境下，无 Windows COM 接口，无法执行 OLE 嵌入';
                }
                if (btn2) {
                    btn2.disabled = true;
                    btn2.title = '服务端运行在 Linux 环境下，请使用选项 1（超链接打包模式）';
                    btn2.style.opacity = '0.5';
                    btn2.style.cursor = 'not-allowed';
                }
                if (card2) {
                    card2.title = '服务端运行在 Linux 环境下，不支持 OLE 嵌入，请选择推荐的【选项 1：超链接打包模式】';
                }
            }

            selectExportOption(1);
            openModal('exportOptionModal');
        }

        function selectExportOption(opt) {
            const card1 = document.getElementById('exportCardOption1');
            const card2 = document.getElementById('exportCardOption2');
            const radio1 = document.getElementById('exportRadioOption1');
            const radio2 = document.getElementById('exportRadioOption2');
            const textLabel = document.getElementById('selectedExportOptionText');

            if (opt === 2 || opt === 'embed') {
                if (window.IS_WINDOWS_SERVER === false) {
                    showToast('当前服务端运行在 Linux 环境下，缺少 Windows Excel COM 引擎，无法生成 OLE 嵌入式 Excel。已为您推荐【选项 1：超链接打包模式】！', 'warning');
                    selectExportOption(1);
                    return;
                }
                currentSelectedExportOption = 2;
                if (radio2) radio2.checked = true;
                if (card1) {
                    card1.style.border = '1px solid #cbd5e1';
                    card1.style.background = '#ffffff';
                }
                if (card2) {
                    card2.style.border = '2px solid #7c3aed';
                    card2.style.background = '#f5f3ff';
                }
                if (textLabel) {
                    textLabel.textContent = '选项 2 (文档嵌入模式)';
                    textLabel.style.color = '#6d28d9';
                }
            } else {
                currentSelectedExportOption = 1;
                if (radio1) radio1.checked = true;
                if (card1) {
                    card1.style.border = '2px solid #2563eb';
                    card1.style.background = '#eff6ff';
                }
                if (card2) {
                    card2.style.border = '1px solid #cbd5e1';
                    card2.style.background = '#ffffff';
                }
                if (textLabel) {
                    textLabel.textContent = '选项 1 (超链接模式)';
                    textLabel.style.color = '#1e3a8a';
                }
            }
        }

        function executeSelectedExportOption() {
            confirmExportOption(currentSelectedExportOption);
        }

        function confirmExportOption(opt) {
            if (!currentProjectId) {
                showToast('请先选择或载入工程项目！', 'warning');
                return;
            }
            closeModal('exportOptionModal');
            if (opt === 1 || opt === 'link') {
                showToast('正在导出并打包 Excel 及关联技术手册 (.zip)...', 'info');
                window.location.href = `/api/export/${currentProjectId}?mode=link`;
            } else {
                if (window.IS_WINDOWS_SERVER === false) {
                    showToast('当前服务端为 Linux 环境，不支持 Windows COM 嵌入，已自动切换为【超链接打包模式】！', 'warning');
                    window.location.href = `/api/export/${currentProjectId}?mode=link`;
                    return;
                }
                showToast('正在通过 Excel 引擎将 PDF 技术手册原件嵌入表格，请稍候...', 'info');
                window.location.href = `/api/export/${currentProjectId}?mode=embed`;
            }
        }

        // --- Export Offline Field Maintenance Package (.zip) directly ---
        function exportOfflinePackage() {
            if (!currentProjectId) {
                showToast('请先选择或载入工程项目！', 'warning');
                return;
            }
            showToast('正在打包整机离线运维资料包（包含SBOM、实物图库、技术PDF与免安装速查网页）...', 'info');
            window.location.href = `/api/project/${currentProjectId}/export_offline_package`;
        }

        // Shortcut listener for export option modal (1, 2, Enter)
        document.addEventListener('keydown', function(e) {
            const modal = document.getElementById('exportOptionModal');
            if (!modal || !modal.classList.contains('show')) return;

            if (e.key === '1') {
                e.preventDefault();
                selectExportOption(1);
            } else if (e.key === '2') {
                e.preventDefault();
                selectExportOption(2);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                executeSelectedExportOption();
            }
        });

        let isRenameProjSystemManual = false;

        async function openNewProjectModal() {
            const legacyEl = document.getElementById('new-proj-name');
            if (legacyEl) legacyEl.value = '';
            const codeEl = document.getElementById('new-proj-code');
            if (codeEl) codeEl.value = '';
            const platEl = document.getElementById('new-proj-platform');
            if (platEl) platEl.value = '';
            const suppEl = document.getElementById('new-proj-supplier');
            if (suppEl) suppEl.value = '';
            const modEl = document.getElementById('new-proj-model');
            if (modEl) modEl.value = '';
            const sysEl = document.getElementById('new-proj-system');

            // 动态拉取系统分类列表并填充下拉框
            const catEl = document.getElementById('new-proj-category');
            if (catEl) {
                try {
                    const res = await safeFetchJson('/api/categories');
                    const categories = (res && res.categories) ? res.categories : [
                        { code: 'pitch', name: '变桨系统', default_system_name: '变桨系统', icon: '' },
                        { code: 'converter', name: '变流器系统', default_system_name: '变流器系统', icon: '' }
                    ];
                    catEl.innerHTML = categories.map(c => 
                        `<option value="${escapeHtml(c.code)}" data-default="${escapeHtml(c.default_system_name || c.name)}">${escapeHtml(c.name)}</option>`
                    ).join('');
                    const defaultCat = (currentMainCategory !== 'all') ? currentMainCategory : 'pitch';
                    catEl.value = defaultCat;
                    const selectedOpt = catEl.options[catEl.selectedIndex];
                    const defName = selectedOpt ? selectedOpt.getAttribute('data-default') : (defaultCat === 'converter' ? '变流器系统' : '变桨系统');
                    if (sysEl) sysEl.value = defName || '变桨系统';
                } catch (e) {
                    console.warn("加载系统分类失败", e);
                    if (sysEl) sysEl.value = '变桨系统';
                }
            }

            updateNewProjectModalPreview();
            openModal('newProjectModal');
            setTimeout(() => {
                if (codeEl) codeEl.focus();
                else if (legacyEl) legacyEl.focus();
            }, 100);
        }

        function onNewProjectCategoryChange() {
            const catEl = document.getElementById('new-proj-category');
            const sysEl = document.getElementById('new-proj-system');
            if (!catEl || !sysEl) return;
            const selectedOpt = catEl.options[catEl.selectedIndex];
            const defName = selectedOpt ? selectedOpt.getAttribute('data-default') : '';
            if (defName) {
                sysEl.value = defName;
            } else {
                sysEl.value = catEl.value === 'converter' ? '变流器系统' : '变桨系统';
            }
            updateNewProjectModalPreview();
        }

        function updateNewProjectModalPreview() {
            const catEl = document.getElementById('new-proj-category');
            const category = (catEl ? catEl.value.trim().toLowerCase() : 'pitch');
            const defaultPart = category === 'converter' ? '变流器系统' : '变桨系统';

            const codeEl = document.getElementById('new-proj-code');
            const platEl = document.getElementById('new-proj-platform');
            const suppEl = document.getElementById('new-proj-supplier');
            const sysEl = document.getElementById('new-proj-system');
            const modEl = document.getElementById('new-proj-model');

            const code = codeEl ? codeEl.value.trim() : '';
            const platform = platEl ? platEl.value.trim() : '';
            const supplier = suppEl ? suppEl.value.trim() : '';
            const system = sysEl ? sysEl.value.trim() : defaultPart;
            const model = modEl ? modEl.value.trim() : '';

            const partName = cleanSubsystemPartName(system, supplier, code, platform, model, defaultPart);
            const modelSuffix = model ? `_${model}` : '';
            const coverTitle = `${supplier}${partName}SBOM${modelSuffix}`;
            const prefixPlatCode = code || platform || 'EW-DEFAULT';
            const bomTitle = `${prefixPlatCode}${supplier}${partName}SBOM${modelSuffix}`;

            const prevCov = document.getElementById('new-proj-preview-cover');
            const prevBom = document.getElementById('new-proj-preview-bom');
            if (prevCov) prevCov.textContent = coverTitle;
            if (prevBom) prevBom.textContent = bomTitle;
        }

        let isSubmittingNewProject = false;
        async function submitNewProject() {
            if (isSubmittingNewProject) return;
            const codeEl = document.getElementById('new-proj-code');
            const codeVal = codeEl ? codeEl.value.trim() : '';
            const legacyEl = document.getElementById('new-proj-name');
            const legacyVal = legacyEl ? legacyEl.value.trim() : '';
            const code = codeVal || legacyVal;

            if (!code) {
                alert('请输入机型代号！');
                if (codeEl) codeEl.focus();
                else if (legacyEl) legacyEl.focus();
                return;
            }

            const catEl = document.getElementById('new-proj-category');
            const category = (catEl ? catEl.value.trim().toLowerCase() : 'pitch');
            const defaultPart = category === 'converter' ? '变流器系统' : '变桨系统';

            const platEl = document.getElementById('new-proj-platform');
            const platform = platEl ? platEl.value.trim() : '';
            const suppEl = document.getElementById('new-proj-supplier');
            const supplier = suppEl ? suppEl.value.trim() : '';
            const sysEl = document.getElementById('new-proj-system');
            const system_name = (sysEl && sysEl.value.trim()) ? sysEl.value.trim() : defaultPart;
            const modEl = document.getElementById('new-proj-model');
            const model = modEl ? modEl.value.trim() : '';

            const btn = document.getElementById('btnSubmitNewProject');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '正在创建...';
            }
            isSubmittingNewProject = true;

            const name = '风力发电机组';

            try {
                const res = await safeFetchJson('/api/project/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, system_name, code, platform, supplier, model, category })
                });
                if (res && res.success) {
                    closeModal('newProjectModal');
                    showToast(`新项目 "${system_name}" 创建成功！`, 'success');
                    loadProjects(res.id);
                } else {
                    alert((res && res.error) || '创建项目失败，请重试');
                }
            } catch (err) {
                alert('创建项目失败: ' + (err.message || '网络连接异常'));
            } finally {
                isSubmittingNewProject = false;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '创建项目';
                }
            }
        }

        function openRenameProjectModal() {
            if (!currentProjectId || !currentProjectData) {
                alert('请先选择一个项目！');
                return;
            }
            if (currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法重命名！如需重命名请先在顶部点击【解锁编辑】。');
                return;
            }
            const displayName = (currentProjectData.system_name && currentProjectData.system_name !== '风力发电机组') ? currentProjectData.system_name : ((currentProjectData.name && currentProjectData.name !== '风力发电机组') ? currentProjectData.name : currentProjectData.code);
            document.getElementById('rename-proj-name').value = displayName;
            openModal('renameProjectModal');
            setTimeout(() => {
                const el = document.getElementById('rename-proj-name');
                if (el) {
                    el.focus();
                    el.select();
                }
            }, 100);
        }

        let isSubmittingRenameProject = false;
        async function submitRenameProject() {
            if (isSubmittingRenameProject || !currentProjectId) return;
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法重命名！如需重命名请先在顶部点击【解锁编辑】。');
                return;
            }
            const inputEl = document.getElementById('rename-proj-name');
            const newName = inputEl ? inputEl.value.trim() : '';
            if (!newName) {
                alert('项目名称不能为空！');
                if (inputEl) inputEl.focus();
                return;
            }

            const btn = document.getElementById('btnSubmitRenameProject');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '正在保存...';
            }
            isSubmittingRenameProject = true;

            try {
                const res = await safeFetchJson('/api/project/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: currentProjectId,
                        system_name: newName,
                        product_name: (currentProjectData && currentProjectData.name) ? currentProjectData.name : '风力发电机组'
                    })
                });
                if (res && res.success) {
                    closeModal('renameProjectModal');
                    showToast(`项目已成功重命名为 "${newName}"！`, 'success');
                    if (currentProjectData) {
                        currentProjectData.system_name = newName;
                        if (res && res.updated_at) currentProjectData.updated_at = res.updated_at;
                    }
                    renderProjectHeaderSummary(currentProjectData);
                    const covSys = document.getElementById('cov-system');
                    if (covSys) covSys.value = newName;
                    const covUp = document.getElementById('cov-updated-at');
                    if (covUp && currentProjectData) covUp.value = currentProjectData.updated_at || '';
                    refreshProjectSelectOnly(currentProjectId);
                } else {
                    alert((res && res.error) || '重命名失败');
                }
            } catch (err) {
                alert('重命名失败: ' + (err.message || '网络连接异常'));
            } finally {
                isSubmittingRenameProject = false;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '确认重命名';
                }
            }
        }

        // ==========================================
        // Copy Project Functions
        // ==========================================
        function openCopyProjectModal() {
            if (!currentProjectId || !currentProjectData) {
                alert('请先选择或打开一个项目！');
                return;
            }
            const displayName = (currentProjectData.system_name && currentProjectData.system_name !== '风力发电机组') ? currentProjectData.system_name : ((currentProjectData.name && currentProjectData.name !== '风力发电机组') ? currentProjectData.name : currentProjectData.code);
            const defaultCopyName = `${displayName}_副本`;
            document.getElementById('copy-proj-name').value = defaultCopyName;
            openModal('copyProjectModal');
            setTimeout(() => {
                const el = document.getElementById('copy-proj-name');
                if (el) {
                    el.focus();
                    el.select();
                }
            }, 100);
        }

        let isSubmittingCopyProject = false;
        async function submitCopyProject() {
            if (isSubmittingCopyProject || !currentProjectId) return;
            const inputEl = document.getElementById('copy-proj-name');
            const newName = inputEl ? inputEl.value.trim() : '';
            if (!newName) {
                alert('项目名称不能为空！');
                if (inputEl) inputEl.focus();
                return;
            }

            const btn = document.getElementById('btnSubmitCopyProject');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '正在复制...';
            }
            isSubmittingCopyProject = true;

            try {
                const res = await safeFetchJson('/api/project/copy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: currentProjectId,
                        name: '风力发电机组',
                        system_name: newName
                    })
                });
                if (res && res.success) {
                    closeModal('copyProjectModal');
                    showToast(res.message || `项目已成功复制为 "${newName}"！`, 'success');
                    loadProjects(res.id);
                } else {
                    alert((res && res.error) || '复制项目失败');
                }
            } catch (err) {
                alert('复制项目失败: ' + (err.message || '网络连接异常'));
            } finally {
                isSubmittingCopyProject = false;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '确认复制';
                }
            }
        }


        // ==========================================
        // Project Bundle Save & Open Functions
        // ==========================================
        let currentOpenProjectInspectData = null;

        function updateSaveFormatStyle() {
            const val = document.querySelector('input[name="saveBundleFormat"]:checked')?.value || 'sbom';
            const lbSbom = document.getElementById('labelSaveSbom');
            const lbJson = document.getElementById('labelSaveJson');
            if (val === 'sbom') {
                lbSbom.style.borderColor = '#2563eb';
                lbSbom.style.background = '#eff6ff';
                lbJson.style.borderColor = '#cbd5e1';
                lbJson.style.background = '#ffffff';
            } else {
                lbJson.style.borderColor = '#059669';
                lbJson.style.background = '#f0fdf4';
                lbSbom.style.borderColor = '#cbd5e1';
                lbSbom.style.background = '#ffffff';
            }
        }

        function openSaveProjectModal() {
            if (!currentProjectId || !currentProjectData) {
                alert('请先选择一个项目！');
                return;
            }
            const displayName = formatProjectDisplayName(currentProjectData);
            document.getElementById('save-proj-title-display').textContent = displayName;
            const subCount = currentProjectData.subsystems ? currentProjectData.subsystems.length : 1;
            document.getElementById('save-proj-stats-display').textContent = `包含 ${subCount} 个子系统 Sheet，机型代号 [${currentProjectData.code || '未设'}]`;
            
            // Default select sbom
            const sbomRadio = document.querySelector('input[name="saveBundleFormat"][value="sbom"]');
            if (sbomRadio) sbomRadio.checked = true;
            updateSaveFormatStyle();

            openModal('saveProjectModal');
        }

        const openExportProjectModal = openSaveProjectModal;

        function executeSaveProjectFile() {
            if (!currentProjectId) return;
            const format = document.querySelector('input[name="saveBundleFormat"]:checked')?.value || 'sbom';
            closeModal('saveProjectModal');
            showToast(`正在生成并下载项目工程文件 (.${format})...`, 'info');
            window.location.href = `/api/project/${currentProjectId}/export_file?format=${format}`;
        }

        function triggerOpenProjectFile() {
            const input = document.getElementById('projectFileInput');
            if (input) {
                input.value = '';
                input.click();
            }
        }

        function handleProjectFileChosen(event) {
            const file = event.target.files[0];
            if (!file) return;

            showToast(`正在解析项目工程文件 "${file.name}"...`, 'info');

            const formData = new FormData();
            formData.append('file', file);

            fetch('/api/project/open/inspect', {
                method: 'POST',
                body: formData
            })
            .then(r => r.json())
            .then(res => {
                if (res.error) {
                    alert(res.error);
                    return;
                }

                currentOpenProjectInspectData = res;

                document.getElementById('open-file-name').textContent = res.original_filename || file.name;
                const ext = (res.original_filename || file.name).split('.').pop().toLowerCase();
                document.getElementById('open-format-badge').textContent = `.${ext} 工程文件`;
                document.getElementById('open-proj-name').textContent = res.name || '未命名项目';
                document.getElementById('open-proj-code').textContent = res.code || '无';
                document.getElementById('open-proj-system').textContent = res.system_name || res.name;
                
                const sheetsText = (res.subsystems_names || []).join('、');
                document.getElementById('open-proj-summary').innerHTML = `
                    <div><b>数据概览：</b> 包含 <b>${res.subsystems_count}</b> 个 Sheet（${sheetsText || '默认清单'}），共 <b>${res.total_items_count}</b> 项物料明细，<b>${res.materials_count}</b> 项主库物料记录。</div>
                `;

                const conflictBanner = document.getElementById('open-conflict-banner');
                const noConflictBanner = document.getElementById('open-noconflict-banner');

                if (res.has_conflict && res.existing_project) {
                    conflictBanner.style.display = 'block';
                    noConflictBanner.style.display = 'none';
                    const existName = res.existing_project.name || res.existing_project.code;
                    document.getElementById('open-existing-name').textContent = `【${existName}】(代号: ${res.existing_project.code || '-'})`;
                    // Default to new
                    const newRadio = document.querySelector('input[name="openConflictAction"][value="new"]');
                    if (newRadio) newRadio.checked = true;
                } else {
                    conflictBanner.style.display = 'none';
                    noConflictBanner.style.display = 'block';
                }

                openModal('openProjectModal');
            })
            .catch(err => {
                alert('解析文件异常: ' + err.message);
            });
        }

        function submitOpenProjectExecute() {
            if (!currentOpenProjectInspectData) return;

            const btn = document.getElementById('btnSubmitOpenProject');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '正在载入项目数据...';
            }

            let action = 'new';
            let targetId = null;
            if (currentOpenProjectInspectData.has_conflict && currentOpenProjectInspectData.existing_project) {
                const checkedRadio = document.querySelector('input[name="openConflictAction"]:checked');
                action = checkedRadio ? checkedRadio.value : 'new';
                if (action === 'overwrite') {
                    targetId = currentOpenProjectInspectData.existing_project.id;
                }
            }

            fetch('/api/project/open/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    temp_filename: currentOpenProjectInspectData.temp_filename,
                    action: action,
                    target_project_id: targetId
                })
            })
            .then(r => r.json())
            .then(res => {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '确认打开';
                }

                if (res.success) {
                    closeModal('openProjectModal');
                    showToast(res.message || '项目已载入。', 'success');
                    loadProjects(res.project_id);
                    loadMasterStats();
                } else {
                    alert(res.error || '打开项目失败');
                }
            })
            .catch(err => {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '确认打开';
                }
                alert('打开项目异常: ' + err.message);
            });
        }

// ==============================================================================
// 页面脚本就绪后立即尝试渲染主界面分类导航与平台下拉（杜绝任何时序白屏）
// ==============================================================================
try {
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                if (typeof renderMainCategoryNav === 'function') renderMainCategoryNav();
                if (typeof renderMainPlatformOptions === 'function') renderMainPlatformOptions();
            });
        } else {
            if (typeof renderMainCategoryNav === 'function') renderMainCategoryNav();
            if (typeof renderMainPlatformOptions === 'function') renderMainPlatformOptions();
        }
    }
} catch (e) {
    console.warn('init renderMainCategoryNav & platform warning:', e);
}


