// ==========================================
// Service BOM - Subsystem Sheets & BOM Items Management
// ==========================================

        function switchTab(tab) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            if (tab === 'cover') {
                clearRowSelection();
                const btnCover = document.getElementById('tab-btn-cover');
                if (btnCover) btnCover.classList.add('active');
                document.getElementById('tabContent-cover').style.display = 'block';
                if (document.getElementById('tabContent-revision')) document.getElementById('tabContent-revision').style.display = 'none';
                document.getElementById('tabContent-bom').style.display = 'none';
            } else if (tab === 'revision') {
                clearRowSelection();
                const btnRev = document.getElementById('tab-btn-revision');
                if (btnRev) btnRev.classList.add('active');
                document.getElementById('tabContent-cover').style.display = 'none';
                if (document.getElementById('tabContent-revision')) document.getElementById('tabContent-revision').style.display = 'block';
                document.getElementById('tabContent-bom').style.display = 'none';
                renderRevisionPage();
            }
        }

        function switchSubsystemTab(subsystemId) {
            clearRowSelection();
            currentSubsystemId = subsystemId;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            const subBtn = document.getElementById(`sub-tab-${subsystemId}`);
            if (subBtn) subBtn.classList.add('active');

            document.getElementById('tabContent-cover').style.display = 'none';
            if (document.getElementById('tabContent-revision')) document.getElementById('tabContent-revision').style.display = 'none';
            document.getElementById('tabContent-bom').style.display = 'block';

            const searchInput = document.getElementById('bomSearchInput');
            if (searchInput) searchInput.value = '';

            applyColumnWidths('bomTable');
            loadBomItems(subsystemId);
        }

        let defaultBomItemsOrder = [];

        function loadBomItems(subsystemId) {
            isFilterDuplicatesOnly = false;
            const btn = document.getElementById('filterDuplicateBtn');
            if (btn) {
                btn.innerHTML = '仅看重复行';
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-outline');
            }
            safeFetchJson(`/api/subsystem/${subsystemId}/items`)
                .then(items => {
                    computeBomHierarchyNumbers(items, 'step10');
                    currentBomItems = items;
                    defaultBomItemsOrder = JSON.parse(JSON.stringify(items));
                    if (typeof resetSortIconsOnly === 'function') {
                        resetSortIconsOnly();
                    }
                    renderBomTable(items);
                })
                .catch(err => {
                    console.error("加载BOM数据异常:", err);
                    showToast('加载BOM数据异常: ' + err.message, 'error');
                });
        }



        let isFilterDuplicatesOnly = false;

        function getSubsystemDuplicateCounts() {
            const map = {};
            (currentBomItems || []).forEach(it => {
                const mNo = (it.material_no || '').trim();
                if (mNo) {
                    map[mNo] = (map[mNo] || 0) + 1;
                }
            });
            return map;
        }

        function toggleFilterDuplicates() {
            isFilterDuplicatesOnly = !isFilterDuplicatesOnly;
            const btn = document.getElementById('filterDuplicateBtn');
            if (isFilterDuplicatesOnly) {
                if (btn) {
                    btn.innerHTML = '显示全部行';
                    btn.classList.remove('btn-outline');
                    btn.classList.add('btn-primary');
                }
                const dupMap = getSubsystemDuplicateCounts();
                const filtered = (currentBomItems || []).filter(it => (dupMap[(it.material_no || '').trim()] || 0) > 1);
                renderBomTable(filtered, false);
            } else {
                if (btn) {
                    btn.innerHTML = '仅看重复行';
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-outline');
                }
                filterBomTable();
            }
        }

        // Tree Folding (Hierarchy Collapse & Expand) State
        let collapsedBomRowIds = new Set();

        function toggleBomRowCollapse(rowId) {
            if (collapsedBomRowIds.has(rowId)) {
                collapsedBomRowIds.delete(rowId);
            } else {
                collapsedBomRowIds.add(rowId);
            }
            renderBomTable(currentBomItems, false);
        }

        function expandAllBomTree() {
            collapsedBomRowIds.clear();
            renderBomTable(currentBomItems, false);
            showToast('已展开当前 Sheet 全部层级与零部件明细。', 'info');
        }

        function collapseAllBomTree() {
            collapsedBomRowIds.clear();
            if (currentBomItems) {
                for (let i = 0; i < currentBomItems.length; i++) {
                    const currLvl = parseInt(currentBomItems[i].level_num) || 2;
                    const nextLvl = (i + 1 < currentBomItems.length) ? (parseInt(currentBomItems[i + 1].level_num) || 2) : 0;
                    if (nextLvl > currLvl) {
                        collapsedBomRowIds.add(currentBomItems[i].id);
                    }
                }
            }
            renderBomTable(currentBomItems, false);
            showToast('已折叠当前 Sheet 所有下属零部件，仅展示主要总成层级。', 'info');
        }

        function renderBomTable(items, updateAlert = true) {
            const tbody = document.getElementById('bomTableBody');
            tbody.innerHTML = '';

            const dupMap = getSubsystemDuplicateCounts();

            if (updateAlert) {
                let dupMatCount = 0;
                let dupRowCount = 0;
                Object.keys(dupMap).forEach(k => {
                    if (dupMap[k] > 1) {
                        dupMatCount++;
                        dupRowCount += dupMap[k];
                    }
                });

                const alertBar = document.getElementById('duplicateAlertBar');
                if (alertBar) {
                    if (dupMatCount > 0) {
                        alertBar.style.display = 'flex';
                        document.getElementById('duplicateMatCount').textContent = dupMatCount;
                        document.getElementById('duplicateRowCount').textContent = dupRowCount;
                    } else {
                        alertBar.style.display = 'none';
                    }
                }
            }

            if (!items || items.length === 0) {
                const emptyText = isFilterDuplicatesOnly ? '当前表中未发现相同物料行' : '暂无物料行，请点击上方“添加物料行”';
                tbody.innerHTML = `<tr><td colspan="16" style="text-align: center; color: var(--text-muted); padding: 30px;">${emptyText}</td></tr>`;
                clearRowSelection();
                return;
            }

            // Prune selection: if items are filtered, remove any selections that are no longer in items
            if (keepSelection && selectedRowIds && selectedRowIds.size > 0 && Array.isArray(items)) {
                const visibleIds = new Set(items.map(it => it.id));
                for (const id of Array.from(selectedRowIds)) {
                    if (!visibleIds.has(id)) {
                        selectedRowIds.delete(id);
                    }
                }
            } else if (!keepSelection) {
                clearRowSelection();
            }

            // Compute hasChildren map for tree folding
            const hasChildrenMap = {};
            for (let i = 0; i < items.length; i++) {
                const currLvl = parseInt(items[i].level_num) || 2;
                const nextLvl = (i + 1 < items.length) ? (parseInt(items[i + 1].level_num) || 2) : 0;
                hasChildrenMap[items[i].id] = (nextLvl > currLvl);
            }

            let hiddenAboveLevel = null;
            const fragment = document.createDocumentFragment();

            items.forEach((it, idx) => {
                const tr = document.createElement('tr');
                const lvl = parseInt(it.level_num) || 2;
                const mNo = (it.material_no || '').trim();
                const isDup = (dupMap[mNo] || 0) > 1;
                const hasChildren = !!hasChildrenMap[it.id];
                const isCollapsed = collapsedBomRowIds.has(it.id);

                // Tree folding visibility check
                let isRowHidden = false;
                if (hiddenAboveLevel !== null) {
                    if (lvl > hiddenAboveLevel) {
                        isRowHidden = true;
                    } else {
                        hiddenAboveLevel = null;
                    }
                }
                if (hiddenAboveLevel === null && hasChildren && isCollapsed) {
                    hiddenAboveLevel = lvl;
                }

                // Render tree toggle icon
                let treeToggleHtml = '';
                if (hasChildren) {
                    treeToggleHtml = `<span class="tree-toggle-btn ${isCollapsed ? 'is-collapsed' : 'is-expanded'}" onclick="event.stopPropagation(); toggleBomRowCollapse(${it.id})" title="${isCollapsed ? '展开下级零部件' : '收起下级零部件'}" style="cursor: pointer; user-select: none; display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 3px; font-size: 9px; margin-right: 4px; background: ${isCollapsed ? '#eff6ff' : '#f8fafc'}; color: ${isCollapsed ? '#2563eb' : '#64748b'}; border: 1px solid ${isCollapsed ? '#93c5fd' : '#cbd5e1'}; font-weight: bold; vertical-align: middle; transition: all 0.15s ease;">${isCollapsed ? '▶' : '▼'}</span>`;
                } else {
                    treeToggleHtml = `<span style="display: inline-block; width: 17px; margin-right: 4px;"></span>`;
                }

                const collapsedHint = (hasChildren && isCollapsed) ? `<span style="font-size: 11px; color: #2563eb; background: #eff6ff; border: 1px solid #bfdbfe; padding: 1px 6px; border-radius: 3px; margin-left: 6px; font-weight: 500;">已折叠下级</span>` : '';

                // Level-specific row styling & visual indentation
                let nameHtml = '';
                let descHtml = '';
                let levelBadgeHtml = '';

                if (lvl === 1) {
                    levelBadgeHtml = `<div style="display: inline-flex; align-items: center; justify-content: center;">${treeToggleHtml}<span class="badge-level lvl-1-badge">● 一级组件</span></div>`;
                    nameHtml = formatPipeMultilineHierarchy(it.m_name || '', '', 0, collapsedHint);
                    descHtml = formatPipeMultilineHierarchy(it.m_desc || '', '', 0);
                } else if (lvl === 2) {
                    levelBadgeHtml = `<div style="display: inline-flex; align-items: center; justify-content: center;">${treeToggleHtml}<span class="badge-level lvl-2-badge">●● 二级</span></div>`;
                    nameHtml = formatPipeMultilineHierarchy(it.m_name || '', '└', 10, collapsedHint);
                    descHtml = formatPipeMultilineHierarchy(it.m_desc || '', '└', 10);
                } else {
                    // 三级增加一个短横 (└─)、四级增加两个短横 (└──)、依次类推
                    const dashes = '─'.repeat(Math.max(1, lvl - 2));
                    const prefixSymbol = `└${dashes}`;
                    const indentPx = 10 + (lvl - 2) * 16;
                    const badgeText = lvl === 3 
                        ? `<span class="badge-level lvl-3-badge">●●● 三级</span>` 
                        : `<span class="badge-level" style="background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 2px 6px; border-radius: 4px; font-size: 11px;">●●●● ${lvl}级</span>`;
                    levelBadgeHtml = `<div style="display: inline-flex; align-items: center; justify-content: center;">${treeToggleHtml}${badgeText}</div>`;
                    nameHtml = formatPipeMultilineHierarchy(it.m_name || '', prefixSymbol, indentPx, collapsedHint);
                    descHtml = formatPipeMultilineHierarchy(it.m_desc || '', prefixSymbol, indentPx);
                }

                if (isRowHidden) {
                    tr.style.display = 'none';
                    tr.classList.add('tr-tree-collapsed');
                }

                const isSelected = selectedRowIds.has(it.id);
                let rowClasses = [];
                if (isDup) {
                    rowClasses.push('tr-duplicate');
                }
                rowClasses.push(`tr-level-${lvl}`);
                if (isSelected) {
                    rowClasses.push('row-selected');
                }
                tr.className = rowClasses.join(' ');
                tr.setAttribute('data-item-id', it.id);
                tr.setAttribute('data-item-idx', idx);
                tr.setAttribute('draggable', isSelected ? 'true' : 'false');
                tr.style.cursor = isSelected ? 'grab' : 'pointer';
                
                tr.onclick = (e) => {
                    if (isRowDragging) return;
                    handleRowClick(idx, it.id, e);
                };
                tr.ondblclick = () => {
                    openEditBomModal(it.id);
                };

                // Drag & Drop event handlers
                tr.ondragstart = (e) => {
                    const q = (document.getElementById('bomSearchInput')?.value || '').trim();
                    if (q) {
                        showToast('请先清空搜索过滤框，再进行拖拽排序', 'warning');
                        e.preventDefault();
                        return false;
                    }
                    draggedRowId = it.id;
                    draggedRowIdx = idx;
                    isRowDragging = true;
                    if (!selectedRowIds.has(it.id)) {
                        selectBomRow(idx, it.id, true);
                    }
                    tr.classList.add('tr-dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(it.id));
                };

                tr.ondragover = (e) => {
                    if (!draggedRowId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const rect = tr.getBoundingClientRect();
                    const isTop = (e.clientY - rect.top) < (rect.height / 2);
                    tbody.querySelectorAll('tr.drop-target-top, tr.drop-target-bottom').forEach(r => {
                        if (r !== tr) r.classList.remove('drop-target-top', 'drop-target-bottom');
                    });
                    if (isTop) {
                        tr.classList.add('drop-target-top');
                        tr.classList.remove('drop-target-bottom');
                    } else {
                        tr.classList.add('drop-target-bottom');
                        tr.classList.remove('drop-target-top');
                    }
                };

                tr.ondragleave = (e) => {
                    const rect = tr.getBoundingClientRect();
                    if (e.clientY < rect.top || e.clientY >= rect.bottom || e.clientX < rect.left || e.clientX >= rect.right) {
                        tr.classList.remove('drop-target-top', 'drop-target-bottom');
                    }
                };

                tr.ondragend = () => {
                    tbody.querySelectorAll('tr').forEach(r => {
                        r.classList.remove('tr-dragging', 'drop-target-top', 'drop-target-bottom');
                    });
                    draggedRowId = null;
                    draggedRowIdx = null;
                    setTimeout(() => { isRowDragging = false; }, 60);
                };

                tr.ondrop = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetItemId = it.id;
                    const srcItemId = draggedRowId;
                    tbody.querySelectorAll('tr').forEach(r => {
                        r.classList.remove('tr-dragging', 'drop-target-top', 'drop-target-bottom');
                    });
                    if (!srcItemId || srcItemId === targetItemId) return;
                    const rect = tr.getBoundingClientRect();
                    const isTop = (e.clientY - rect.top) < (rect.height / 2);
                    handleRowDropReorder(srcItemId, targetItemId, isTop);
                };

                // Duplicate badge on material number
                let dupBadge = '';
                if (isDup) {
                    dupBadge = `<span class="badge-duplicate" title="物料号 ${mNo} 在当前表中存在重复行 (共出现 ${dupMap[mNo]} 次)">重复 (${dupMap[mNo]})</span>`;
                }

                // Manual column
                let manualHtml = `<span class="manual-empty" onclick="event.stopPropagation(); triggerManualUpload('${it.material_no}')">上传手册</span>`;
                if (it.manual_path) {
                    manualHtml = `<button type="button" class="manual-link" style="border: 1px solid #bae6fd; cursor: pointer; background: #f0f9ff;" onclick="event.stopPropagation(); previewManualOnline('/${it.manual_path}', '${it.material_no}', '${(it.m_name || '').replace(/'/g, "\\'")}')" title="在线查阅 PDF 技术手册">查看手册</button>`;
                }

                // Image column
                let imgHtml = `<span class="thumb-placeholder" onclick="event.stopPropagation(); triggerImgUpload('${it.material_no}')">上传图片</span>`;
                if (it.image_path) {
                    imgHtml = `<img src="/${it.image_path}" class="thumb-img" onclick="event.stopPropagation(); showImgPreview('/${it.image_path}')" title="点击放大图片">`;
                }

                tr.innerHTML = `
                    <td class="col-center" onclick="event.stopPropagation();" style="width: 38px; min-width: 38px; max-width: 38px;">
                        <input type="checkbox" class="bom-row-checkbox" data-id="${it.id}" data-idx="${idx}" ${isSelected ? 'checked' : ''} onchange="toggleRowSelectionById(${it.id}, ${idx}, event)" style="cursor: pointer; width: 14px; height: 14px; margin: 0; vertical-align: middle;">
                    </td>
                    <td class="col-center" style="white-space: nowrap;"><span class="row-drag-handle" title="按住拖拽排序" onmousedown="event.stopPropagation(); selectBomRow(${idx}, ${it.id});">⠿</span>${it.row_num}</td>
                    <td class="col-center">${levelBadgeHtml}</td>
                    <td class="col-center">${formatPipeMultilineHtml(it.seq_num, true)}</td>
                    <td>${formatPipeMultilineMatNo(it.material_no, dupBadge)}</td>
                    <td>${nameHtml}</td>
                    <td>${descHtml}</td>
                    <td>${formatPipeMultilineHtml(it.m_model || '')}</td>
                    <td>${formatPipeMultilineHtml(it.m_mfr || '')}</td>
                    <td class="col-center">${formatPipeMultilineHtml(it.qty, true)}</td>
                    <td class="col-center">${formatPipeMultilineHtml(it.unit || it.m_unit || 'PC', true)}</td>
                    <td class="col-center">${manualHtml}</td>
                    <td class="col-center">${imgHtml}</td>
                    <td>${formatPipeMultilineHtml((it.drawing_no && it.drawing_no !== '/') ? it.drawing_no : (it.m_drawing_no || '/'))}</td>
                    <td>${formatPipeMultilineHtml(it.notes || '')}</td>
                    <td>${formatPipeMultilineHtml(it.substitute || it.m_substitute || '')}</td>
                `;
                fragment.appendChild(tr);
            });
            tbody.appendChild(fragment);

            // Update row action buttons & selection visuals
            syncSelectionVisuals();
            updateRowActionButtons();
        }


        // ==========================================
        // Row Selection & Unified Toolbar Actions (Multi-Select Enabled)
        // ==========================================
        let selectedRowIds = new Set();
        let selectedRowId = null;
        let selectedRowIdx = null;
        let lastSelectedIdx = null;
        let draggedRowId = null;
        let draggedRowIdx = null;
        let isRowDragging = false;

        function handleRowClick(idx, id, event) {
            if (isRowDragging) return;

            if (event && event.shiftKey && lastSelectedIdx !== null) {
                // Shift + Click: Range selection
                const start = Math.min(lastSelectedIdx, idx);
                const end = Math.max(lastSelectedIdx, idx);
                const rows = document.querySelectorAll('#bomTableBody tr[data-item-id]');
                for (let i = start; i <= end; i++) {
                    if (rows[i]) {
                        const rowId = parseInt(rows[i].getAttribute('data-item-id'));
                        if (rowId) selectedRowIds.add(rowId);
                    }
                }
            } else if (event && (event.ctrlKey || event.metaKey)) {
                // Ctrl / Cmd + Click: Toggle individual row
                if (selectedRowIds.has(id)) {
                    selectedRowIds.delete(id);
                } else {
                    selectedRowIds.add(id);
                }
                lastSelectedIdx = idx;
            } else {
                // Normal click: exclusive selection of this row
                selectedRowIds.clear();
                selectedRowIds.add(id);
                lastSelectedIdx = idx;
            }

            syncSelectionVisuals();
            updateRowActionButtons();
        }

        function toggleRowSelectionById(id, idx, event) {
            if (event) event.stopPropagation();

            if (event && event.shiftKey && lastSelectedIdx !== null) {
                const start = Math.min(lastSelectedIdx, idx);
                const end = Math.max(lastSelectedIdx, idx);
                const rows = document.querySelectorAll('#bomTableBody tr[data-item-id]');
                for (let i = start; i <= end; i++) {
                    if (rows[i]) {
                        const rowId = parseInt(rows[i].getAttribute('data-item-id'));
                        if (rowId) selectedRowIds.add(rowId);
                    }
                }
            } else {
                if (selectedRowIds.has(id)) {
                    selectedRowIds.delete(id);
                } else {
                    selectedRowIds.add(id);
                }
                lastSelectedIdx = idx;
            }

            syncSelectionVisuals();
            updateRowActionButtons();
        }

        function toggleSelectAllBom(checked) {
            const tbody = document.getElementById('bomTableBody');
            if (!tbody) return;

            const rows = tbody.querySelectorAll('tr[data-item-id]');
            if (checked) {
                rows.forEach(tr => {
                    const id = parseInt(tr.getAttribute('data-item-id'));
                    if (id) selectedRowIds.add(id);
                });
            } else {
                selectedRowIds.clear();
            }

            syncSelectionVisuals();
            updateRowActionButtons();
        }

        function selectBomRow(idx, id, exclusive = true) {
            if (isRowDragging) return;
            if (exclusive) {
                selectedRowIds.clear();
                selectedRowIds.add(id);
            } else {
                selectedRowIds.add(id);
            }
            lastSelectedIdx = idx;
            syncSelectionVisuals();
            updateRowActionButtons();
        }

        function syncSelectionVisuals() {
            const tbody = document.getElementById('bomTableBody');
            if (!tbody) return;

            let checkedCount = 0;
            const rows = tbody.querySelectorAll('tr[data-item-id]');
            rows.forEach(tr => {
                const id = parseInt(tr.getAttribute('data-item-id'));
                const isSelected = selectedRowIds.has(id);
                const cb = tr.querySelector('.bom-row-checkbox');
                if (cb) cb.checked = isSelected;

                if (isSelected) {
                    tr.classList.add('row-selected');
                    tr.setAttribute('draggable', 'true');
                    tr.style.cursor = 'grab';
                    checkedCount++;
                } else {
                    tr.classList.remove('row-selected');
                    tr.setAttribute('draggable', 'false');
                    tr.style.cursor = 'pointer';
                }
            });

            // Update header checkbox
            const headerCb = document.getElementById('selectAllBomCheckbox');
            if (headerCb) {
                if (rows.length === 0 || checkedCount === 0) {
                    headerCb.checked = false;
                    headerCb.indeterminate = false;
                } else if (checkedCount === rows.length) {
                    headerCb.checked = true;
                    headerCb.indeterminate = false;
                } else {
                    headerCb.checked = false;
                    headerCb.indeterminate = true;
                }
            }

            // Sync single selected row for legacy calls
            if (selectedRowIds.size >= 1) {
                selectedRowId = selectedRowIds.values().next().value;
                selectedRowIdx = (currentBomItems || []).findIndex(it => it.id === selectedRowId);
            } else {
                selectedRowId = null;
                selectedRowIdx = null;
            }
        }

        function clearRowSelection() {
            selectedRowIds.clear();
            selectedRowId = null;
            selectedRowIdx = null;
            lastSelectedIdx = null;
            syncSelectionVisuals();
            updateRowActionButtons();
        }

        function handleRowDropReorder(srcItemId, targetItemId, isTop) {
            if (currentProjectData && currentProjectData.is_locked == 1) {
                showToast('当前工程处于【锁定保护】状态，禁止拖拽排序！', 'warning');
                return;
            }
            if (!currentBomItems || currentBomItems.length === 0) return;
            
            const srcIndex = currentBomItems.findIndex(it => it.id === srcItemId);
            const targetIndex = currentBomItems.findIndex(it => it.id === targetItemId);
            if (srcIndex === -1 || targetIndex === -1 || srcIndex === targetIndex) return;
            
            // Find the subtree block for the dragged item (including all deeper children)
            const srcLvl = currentBomItems[srcIndex].level_num || 2;
            let srcEnd = srcIndex + 1;
            while (srcEnd < currentBomItems.length && (currentBomItems[srcEnd].level_num || 2) > srcLvl) {
                srcEnd++;
            }
            
            // If target is inside dragged block, ignore (cannot drop parent inside its own children)
            if (targetIndex >= srcIndex && targetIndex < srcEnd) {
                showToast('不能将父级组件拖放到自身的子层级中', 'warning');
                return;
            }
            
            // Extract the dragged block
            const draggedBlock = currentBomItems.slice(srcIndex, srcEnd);
            
            // Remaining items after removing dragged block
            const remaining = currentBomItems.filter((_, i) => i < srcIndex || i >= srcEnd);
            
            // Find the new index of targetItem in remaining array
            const targetInRem = remaining.findIndex(it => it.id === targetItemId);
            if (targetInRem === -1) return;
            
            let insertIndex;
            if (isTop) {
                insertIndex = targetInRem;
            } else {
                // Drop after target item's subtree block
                const targetLvl = remaining[targetInRem].level_num || 2;
                let targetEnd = targetInRem + 1;
                while (targetEnd < remaining.length && (remaining[targetEnd].level_num || 2) > targetLvl) {
                    targetEnd++;
                }
                insertIndex = targetEnd;
            }
            
            // Insert draggedBlock into remaining at insertIndex
            remaining.splice(insertIndex, 0, ...draggedBlock);
            
            const newIds = remaining.map(it => it.id);
            
            // Send to backend /api/bom/reorder
            safeFetchJson('/api/bom/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subsystem_id: currentSubsystemId,
                    item_ids: newIds
                })
            }).then(res => {
                if (res.success) {
                    selectedRowIds.clear();
                    selectedRowIds.add(srcItemId);
                    loadBomItems(currentSubsystemId);
                    if (typeof refreshCurrentProjectUpdatedAt === 'function') refreshCurrentProjectUpdatedAt();
                    showToast('已完成拖动排序，行号与结构代码已自动重排！', 'success');
                } else {
                    showToast(res.error || '排序失败', 'error');
                }
            }).catch(err => {
                showToast('排序失败: ' + err.message, 'error');
            });
        }

        function updateRowActionButtons() {
            const btnEdit = document.getElementById('btnRowEdit');
            const btnMoveUp = document.getElementById('btnRowMoveUp');
            const btnMoveDown = document.getElementById('btnRowMoveDown');
            const btnDelete = document.getElementById('btnRowDelete');
            const btnCopy = document.getElementById('btnRowCopy');
            const btnPaste = document.getElementById('btnRowPaste');
            const indicator = document.getElementById('selectedRowIndicator');
            const selRowNumBadge = document.getElementById('selRowNumBadge');
            const selRowMatBadge = document.getElementById('selRowMatBadge');
            const count = selectedRowIds.size;
            const copiedCount = getCopiedBomRowsCount();

            const isLocked = currentProjectData && (currentProjectData.is_locked == 1);

            if (isLocked) {
                if (btnCopy) {
                    btnCopy.disabled = (count === 0);
                    btnCopy.title = count > 0 ? `复制选中的 ${count} 行物料 (Ctrl+C，支持跨Sheet与跨项目粘贴)` : '请先在下方表格中勾选或点击选中物料行，再执行复制 (Ctrl+C)';
                }
                if (btnPaste) {
                    btnPaste.disabled = true;
                    btnPaste.innerHTML = copiedCount > 0 ? `📋 粘贴行 (${copiedCount})` : '📋 粘贴行';
                    btnPaste.title = '当前工程已锁定，如需粘贴物料请先点击【解锁】';
                }
                if (btnEdit) {
                    btnEdit.disabled = (count !== 1);
                    btnEdit.innerHTML = '查看明细';
                    btnEdit.title = count === 1 ? '查看当前选中物料的明细详情（只读）' : '请先在下方表格中点击选中单行以查看明细';
                }
                if (btnMoveUp) { btnMoveUp.disabled = true; btnMoveUp.title = '当前工程已锁定，如需移动物料请先点击【解锁】'; }
                if (btnMoveDown) { btnMoveDown.disabled = true; btnMoveDown.title = '当前工程已锁定，如需移动物料请先点击【解锁】'; }
                if (btnDelete) {
                    btnDelete.disabled = true;
                    btnDelete.innerHTML = '删除';
                    btnDelete.title = '当前工程已锁定，如需删除物料请先点击【解锁】';
                }
                if (count === 0) {
                    if (indicator) indicator.style.display = 'none';
                } else if (count === 1) {
                    const singleId = selectedRowIds.values().next().value;
                    const item = (currentBomItems || []).find(it => it.id === singleId);
                    if (indicator) {
                        indicator.style.display = 'inline-flex';
                        if (selRowNumBadge) selRowNumBadge.textContent = item ? item.row_num : '1';
                        if (selRowMatBadge) selRowMatBadge.textContent = item ? item.material_no : '';
                    }
                } else {
                    if (indicator) {
                        indicator.style.display = 'inline-flex';
                        if (selRowNumBadge) selRowNumBadge.textContent = `已选 ${count} 行`;
                        if (selRowMatBadge) selRowMatBadge.textContent = '多项选择';
                    }
                }
                return;
            }

            if (btnEdit) btnEdit.innerHTML = '编辑';

            // 复制与粘贴按钮状态维护
            if (btnCopy) {
                if (count > 0) {
                    btnCopy.disabled = false;
                    btnCopy.title = `复制选中的 ${count} 行物料 (Ctrl+C，支持跨Sheet与跨项目粘贴)`;
                } else {
                    btnCopy.disabled = true;
                    btnCopy.title = '请先在下方表格中勾选或点击选中物料行，再执行复制 (Ctrl+C)';
                }
            }

            if (btnPaste) {
                if (copiedCount > 0) {
                    btnPaste.disabled = false;
                    btnPaste.innerHTML = `📋 粘贴行 (${copiedCount})`;
                    btnPaste.title = `粘贴剪贴板中的 ${copiedCount} 行物料 (Ctrl+V，插入在选中行之后或末尾，支持跨Sheet与跨项目)`;
                } else {
                    btnPaste.disabled = true;
                    btnPaste.innerHTML = '📋 粘贴行';
                    btnPaste.title = '剪贴板为空，请先在任意Sheet或项目中选中物料行并点击【复制行】(Ctrl+C)';
                }
            }

            if (count === 0) {
                if (btnEdit) { btnEdit.disabled = true; btnEdit.title = '请先在下方表格中勾选或点击选中一行，再进行编辑'; }
                if (btnMoveUp) { btnMoveUp.disabled = true; btnMoveUp.title = '请先在下方表格中勾选或点击选中一行，再执行上移'; }
                if (btnMoveDown) { btnMoveDown.disabled = true; btnMoveDown.title = '请先在下方表格中勾选或点击选中一行，再执行下移'; }
                if (btnDelete) {
                    btnDelete.disabled = true;
                    btnDelete.innerHTML = '删除';
                    btnDelete.title = '请先在下方表格中勾选或点击选中物料行，再执行删除';
                }
                if (indicator) indicator.style.display = 'none';
            } else if (count === 1) {
                const singleId = selectedRowIds.values().next().value;
                const item = (currentBomItems || []).find(it => it.id === singleId);
                if (btnEdit) { btnEdit.disabled = false; btnEdit.title = '编辑当前选中的物料行'; }
                if (btnMoveUp) { btnMoveUp.disabled = false; btnMoveUp.title = '上移当前选中的物料行（子层级自动整组跟随）'; }
                if (btnMoveDown) { btnMoveDown.disabled = false; btnMoveDown.title = '下移当前选中的物料行（子层级自动整组跟随）'; }
                if (btnDelete) {
                    btnDelete.disabled = false;
                    btnDelete.innerHTML = '删除';
                    btnDelete.title = '删除当前选中的物料行';
                }
                if (indicator) {
                    indicator.style.display = 'inline-flex';
                    if (selRowNumBadge) selRowNumBadge.textContent = item ? item.row_num : '1';
                    if (selRowMatBadge) selRowMatBadge.textContent = item ? item.material_no : '';
                }
            } else {
                // Multi-selection mode (count > 1)
                if (btnEdit) { btnEdit.disabled = true; btnEdit.title = '多选模式下不支持单行编辑，请仅选中 1 行'; }
                if (btnMoveUp) { btnMoveUp.disabled = true; btnMoveUp.title = '多选模式下不支持批量移动，请仅选中 1 行'; }
                if (btnMoveDown) { btnMoveDown.disabled = true; btnMoveDown.title = '多选模式下不支持批量移动，请仅选中 1 行'; }
                if (btnDelete) {
                    btnDelete.disabled = false;
                    btnDelete.innerHTML = `批量删除 (${count})`;
                    btnDelete.title = `批量删除选中的 ${count} 行物料`;
                }
                if (indicator) {
                    indicator.style.display = 'inline-flex';
                    if (selRowNumBadge) selRowNumBadge.textContent = `已选 ${count} 行`;
                    if (selRowMatBadge) selRowMatBadge.textContent = '多项选择';
                }
            }
        }

        function editSelectedRow() {
            if (selectedRowIds.size === 0) {
                showToast('请先在表格中点击选中一行！', 'error');
                return;
            }
            if (selectedRowIds.size > 1) {
                showToast('当前已选中多行，请仅选中单行进行编辑！', 'warning');
                return;
            }
            const singleId = selectedRowIds.values().next().value;
            openEditBomModal(singleId);
        }

        function moveSelectedRow(dir) {
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法移动物料行！如需编辑请先点击【解锁编辑】。');
                return;
            }
            if (selectedRowIds.size === 0) {
                showToast('请先在表格中点击选中一行！', 'error');
                return;
            }
            if (selectedRowIds.size > 1) {
                showToast('当前已选中多行，请仅选中单行执行移动！', 'warning');
                return;
            }
            const singleId = selectedRowIds.values().next().value;
            moveRow(singleId, dir);
        }

        function deleteSelectedRow() {
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法删除物料行！如需编辑请先点击【解锁编辑】。');
                return;
            }
            if (selectedRowIds.size === 0) {
                showToast('请先在表格中勾选或点击选中物料行！', 'error');
                return;
            }

            const ids = Array.from(selectedRowIds);
            let confirmMsg = '';
            if (ids.length === 1) {
                confirmMsg = '确认删除该物料行吗？';
            } else {
                confirmMsg = `确认批量删除选中的 ${ids.length} 行物料吗？`;
            }

            if (confirm(confirmMsg)) {
                safeFetchJson('/api/bom/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: ids })
                }).then(res => {
                    clearRowSelection();
                    loadBomItems(currentSubsystemId);
                    if (typeof refreshCurrentProjectUpdatedAt === 'function') refreshCurrentProjectUpdatedAt();
                    showToast(ids.length === 1 ? '物料行已删除，行号与层级序号已自动重排！' : `已成功批量删除 ${ids.length} 行物料！`, 'info');
                }).catch(err => {
                    alert('删除失败: ' + err.message);
                });
            }
        }

        // ==========================================
        // 跨Sheet、跨项目 BOM 行复制与粘贴 (Clipboard Engine)
        // ==========================================
        const BOM_CLIPBOARD_STORAGE_KEY = 'sbom_clipboard_bom_rows';

        function getCopiedBomRowsCount() {
            try {
                const raw = localStorage.getItem(BOM_CLIPBOARD_STORAGE_KEY);
                if (!raw) return 0;
                const data = JSON.parse(raw);
                return Array.isArray(data?.items) ? data.items.length : 0;
            } catch (e) {
                return 0;
            }
        }

        function copySelectedBomRows() {
            if (!currentBomItems || currentBomItems.length === 0 || selectedRowIds.size === 0) {
                showToast('请先在表格中勾选或选中要复制的物料行！', 'warning');
                return;
            }

            // 按表格原生行号 row_num 升序提取选中的物料行，保持顺序
            const selectedItems = currentBomItems
                .filter(it => selectedRowIds.has(it.id))
                .sort((a, b) => (a.row_num || 0) - (b.row_num || 0));

            if (selectedItems.length === 0) {
                showToast('未找到选中的物料行数据', 'warning');
                return;
            }

            const itemsToCopy = selectedItems.map(it => ({
                material_no: it.material_no || '',
                level_str: it.level_str || '••',
                level_num: it.level_num || 2,
                parent_material_no: it.parent_material_no || '',
                drawing_no: (it.drawing_no && it.drawing_no !== '/') ? it.drawing_no : (it.m_drawing_no || '/'),
                qty: String(it.qty || '1'),
                unit: it.unit || it.m_unit || 'PC',
                notes: it.notes || '',
                substitute: it.substitute || '',
                // 携带主库元数据，保障跨全新项目或跨环境粘贴时主库完整性
                name: it.m_name || it.name || '',
                description: it.m_desc || it.description || '',
                spec_model: it.m_model || it.spec_model || '',
                manufacturer: it.m_mfr || it.manufacturer || ''
            }));

            const clipboardPayload = {
                version: '1.0',
                timestamp: Date.now(),
                source_project_id: typeof currentProjectId !== 'undefined' ? currentProjectId : null,
                source_project_name: (currentProjectData && (currentProjectData.system_name || currentProjectData.code)) || '项目',
                source_subsystem_id: typeof currentSubsystemId !== 'undefined' ? currentSubsystemId : null,
                items: itemsToCopy
            };

            try {
                localStorage.setItem(BOM_CLIPBOARD_STORAGE_KEY, JSON.stringify(clipboardPayload));
                updateRowActionButtons();
                const tip = itemsToCopy.length === 1 
                    ? `已成功复制物料 [${itemsToCopy[0].material_no}]！\n可在当前/其他 Sheet 或切换至其他项目后点击【粘贴行】(Ctrl+V)` 
                    : `已成功复制 ${itemsToCopy.length} 行物料！\n可在当前/其他 Sheet 或切换至其他项目后点击【粘贴行】(Ctrl+V)`;
                showToast(tip, 'success');
            } catch (err) {
                console.error('存储剪贴板失败:', err);
                showToast('复制失败: 无法保存至本地存储: ' + err.message, 'error');
            }
        }

        async function pasteBomRows() {
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法粘贴物料行！如需编辑请先点击【解锁编辑】。');
                return;
            }

            if (typeof currentSubsystemId === 'undefined' || !currentSubsystemId) {
                showToast('当前未选择任何 Sheet 子系统，无法执行粘贴！', 'warning');
                return;
            }

            let raw = null;
            try {
                raw = localStorage.getItem(BOM_CLIPBOARD_STORAGE_KEY);
            } catch (e) {
                console.error('读取剪贴板失败:', e);
            }

            if (!raw) {
                showToast('剪贴板为空！请先在表格中勾选物料行，点击【复制行】或按 Ctrl+C。', 'warning');
                return;
            }

            let clipData = null;
            try {
                clipData = JSON.parse(raw);
            } catch (e) {
                showToast('剪贴板数据解析失败', 'error');
                return;
            }

            const items = clipData?.items;
            if (!Array.isArray(items) || items.length === 0) {
                showToast('剪贴板中无有效物料数据！', 'warning');
                return;
            }

            // 确定插入目标位置：
            // 若当前表格已选中某行，则插入在选中的最后一行之后；若未选中则追加到当前 Sheet 末尾
            let maxSelectedRowNum = null;
            if (selectedRowIds && selectedRowIds.size > 0 && Array.isArray(currentBomItems) && currentBomItems.length > 0) {
                currentBomItems.forEach(it => {
                    if (selectedRowIds.has(it.id)) {
                        if (maxSelectedRowNum === null || it.row_num > maxSelectedRowNum) {
                            maxSelectedRowNum = it.row_num;
                        }
                    }
                });
            }

            const btnPaste = document.getElementById('btnRowPaste');
            const origHtml = btnPaste ? btnPaste.innerHTML : '📋 粘贴行';
            if (btnPaste) {
                btnPaste.disabled = true;
                btnPaste.innerHTML = '粘贴中...';
            }

            try {
                const payload = {
                    subsystem_id: currentSubsystemId,
                    insert_after_row: maxSelectedRowNum,
                    items: items
                };

                const res = await safeFetchJson('/api/bom/paste', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res && res.success) {
                    // 自动高亮选中刚粘贴成功的行
                    selectedRowIds.clear();
                    if (Array.isArray(res.inserted_ids)) {
                        res.inserted_ids.forEach(id => selectedRowIds.add(id));
                    }
                    loadBomItems(currentSubsystemId);
                    if (typeof refreshCurrentProjectUpdatedAt === 'function') {
                        refreshCurrentProjectUpdatedAt();
                    }
                    const srcInfo = clipData.source_project_name ? ` (来源: ${clipData.source_project_name})` : '';
                    showToast(`已成功粘贴 ${res.pasted_count || items.length} 行物料！${srcInfo}`, 'success');
                } else {
                    showToast((res && res.error) || '粘贴失败', 'error');
                }
            } catch (err) {
                console.error('粘贴请求异常:', err);
                showToast('粘贴请求异常: ' + (err.message || '网络连接失败'), 'error');
            } finally {
                updateRowActionButtons();
            }
        }

        // --- Filter BOM Table ---
        function filterBomTable() {
            const q = (document.getElementById('bomSearchInput').value || '').trim().toLowerCase();
            if (!q) {
                renderBomTable(currentBomItems);
                return;
            }
            const terms = q.split(/\s+/);
            const filtered = currentBomItems.filter(it => {
                const combined = `${it.material_no || ''} ${it.m_name || ''} ${it.m_desc || ''} ${it.m_model || ''} ${it.m_mfr || ''} ${it.drawing_no || ''} ${it.notes || ''}`.toLowerCase();
                return terms.every(t => combined.includes(t));
            });
            renderBomTable(filtered);
        }

        // --- Move & Delete ---
        function moveRow(id, dir) {
            if (currentProjectData && currentProjectData.is_locked == 1) {
                showToast('当前工程处于【锁定保护】状态，无法移动物料行！', 'error');
                return;
            }
            safeFetchJson('/api/bom/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, direction: dir })
            }).then(res => {
                if (res.success) {
                    loadBomItems(currentSubsystemId);
                    if (typeof refreshCurrentProjectUpdatedAt === 'function') refreshCurrentProjectUpdatedAt();
                    showToast('已调整位置，下属子层级物料已完整跟随！', 'info');
                } else {
                    showToast(res.error || '移动失败', 'error');
                }
            }).catch(err => {
                showToast('移动失败: ' + err.message, 'error');
            });
        }

        // --- Fuzzy Search & Dropdown Handlers ---
        function handleFieldFuzzy(fieldKey, kw, containerId) {
            renderFieldFuzzyDropdown(fieldKey, kw, containerId);
        }

        function handleFuzzySearch(kw) {
            renderFieldFuzzyDropdown('material_no', kw, 'fuzzyDropdownResults');
        }

        function handleDescFuzzy(kw) {
            renderFieldFuzzyDropdown('description', kw, 'descFuzzyDropdown');
        }

        function renderFuzzyDropdown(kw, containerId) {
            renderFieldFuzzyDropdown('description', kw, containerId);
        }

        function closeAllFuzzyDropdowns() {
            document.querySelectorAll('#bomItemModal .fuzzy-dropdown').forEach(d => {
                d.style.display = 'none';
            });
        }

        function renderFieldFuzzyDropdown(fieldKey, kw, containerId) {
            const dropdown = document.getElementById(containerId);
            if (!dropdown) return;

            // Close other dropdowns in the modal
            document.querySelectorAll('#bomItemModal .fuzzy-dropdown').forEach(d => {
                if (d.id !== containerId) d.style.display = 'none';
            });

            const query = (kw || '').trim().toLowerCase();
            if (!query || query === '/') {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
                return;
            }

            const terms = query.split(/\s+/).filter(Boolean);
            if (terms.length === 0) {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
                return;
            }

            // Priority matching: items whose specific field matches get top rank
            const primary = [];
            const secondary = [];

            (allMasterMaterials || []).forEach(m => {
                const targetVal = String(m[fieldKey] || '').toLowerCase();
                const combined = `${m.material_no || ''} ${m.name || ''} ${m.description || ''} ${m.spec_model || ''} ${m.manufacturer || ''} ${m.drawing_no || ''} ${m.substitute || ''}`.toLowerCase();

                if (terms.every(t => targetVal.includes(t))) {
                    primary.push(m);
                } else if (terms.every(t => combined.includes(t))) {
                    secondary.push(m);
                }
            });

            const matched = [...primary, ...secondary].slice(0, 10);

            if (matched.length === 0) {
                dropdown.innerHTML = `<div style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">未在物料主库中找到匹配物料（可直接手动输入新物料）</div>`;
                dropdown.style.display = 'block';
                return;
            }

            dropdown.innerHTML = '';
            matched.forEach(m => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'fuzzy-item';
                
                let thumbHtml = `<div class="fuzzy-thumb-empty">无图</div>`;
                if (m.image_path) {
                    thumbHtml = `<img src="/${m.image_path}" class="fuzzy-thumb" onerror="this.onerror=null; this.parentNode.innerHTML='<div class=\\'fuzzy-thumb-empty\\'>无图</div>';">`;
                }

                let childBadge = (m.child_count > 0) ? `<span style="font-size: 10px; background: #dcfce7; color: #166534; padding: 1px 6px; border-radius: 4px; font-weight: 500;">含 ${m.child_count} 项子层</span>` : '';
                itemDiv.innerHTML = `
                    ${thumbHtml}
                    <div class="fuzzy-info" style="min-width: 0; flex: 1;">
                        <div class="fuzzy-title" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span style="font-weight: 600; color: #1d4ed8;">${escapeHtml(m.material_no)}</span>
                            <span style="color: #1e293b; font-weight: 500;">${escapeHtml(m.name || '')}</span>
                            ${m.manufacturer ? `<span style="font-size: 11px; background: #f1f5f9; color: #475569; padding: 1px 6px; border-radius: 4px; border: 1px solid #e2e8f0;">${escapeHtml(m.manufacturer)}</span>` : ''}
                            ${childBadge}
                        </div>
                        ${m.description ? `<div class="fuzzy-desc" style="font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; margin-top: 2px;" title="${escapeHtml(m.description)}">${escapeHtml(m.description)}</div>` : ''}
                        <div class="fuzzy-sub" style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                            ${m.spec_model ? `<span style="color: #475569;">型号: <b>${escapeHtml(m.spec_model)}</b></span> &nbsp;|&nbsp; ` : ''}
                            ${m.drawing_no && m.drawing_no !== '/' ? `<span>图号: ${escapeHtml(m.drawing_no)}</span> &nbsp;|&nbsp; ` : ''}
                            <span>单位: ${escapeHtml(m.unit || 'PC')}</span>
                        </div>
                    </div>
                `;
                itemDiv.onmousedown = (e) => {
                    e.preventDefault();
                    selectMasterMaterial(m);
                    closeAllFuzzyDropdowns();
                };
                dropdown.appendChild(itemDiv);
            });
            dropdown.style.display = 'block';
        }

        // --- Child Hierarchy Detection & Auto-Import Prompt ---
        let currentMaterialChildren = [];

        function hideChildPromptBox() {
            currentMaterialChildren = [];
            const box = document.getElementById('modal-children-prompt-box');
            if (box) box.style.display = 'none';
        }

        function checkMaterialChildren(materialNo) {
            const cleanNo = (materialNo || '').trim();
            const editId = document.getElementById('edit-bom-id').value;
            // Only prompt when adding a new row (not editing an existing row)
            if (!cleanNo || editId) {
                hideChildPromptBox();
                return;
            }

            fetch(`/api/material/${encodeURIComponent(cleanNo)}/children`)
                .then(r => r.json())
                .then(data => {
                    const box = document.getElementById('modal-children-prompt-box');
                    if (!box) return;

                    if (data.has_children && data.count > 0) {
                        currentMaterialChildren = data.children;
                        document.getElementById('childCountBadge').textContent = data.count;
                        document.getElementById('childPreviewSummaryCount').textContent = data.count;

                        const container = document.getElementById('childPreviewItemsContainer');
                        container.innerHTML = '';
                        data.children.forEach(c => {
                            const itemDiv = document.createElement('div');
                            itemDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: #f8fafc; border-radius: 4px; font-size: 11px;';
                            const lvl = c.child_level_num || 2;
                            const indent = lvl === 3 ? 'padding-left: 20px;' : 'padding-left: 4px;';
                            const badge = lvl === 3 ? '<span class="badge-level lvl-3-badge" style="font-size: 10px; padding: 1px 4px;">●●● 三级</span>' : '<span class="badge-level lvl-2-badge" style="font-size: 10px; padding: 1px 4px;">●● 二级</span>';
                            itemDiv.innerHTML = `
                                <div style="display: flex; align-items: center; gap: 8px; ${indent}">
                                    ${badge}
                                    <b style="color: #1e3a8a;">${c.child_material_no}</b>
                                    <span style="color: #334155;">${c.m_name || ''}</span>
                                    <span style="color: #64748b; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${c.m_desc || ''}">${c.m_desc || ''}</span>
                                </div>
                                <div style="color: #475569; font-weight: 500;">
                                    用量: ${c.qty || '1'} ${c.unit || c.m_unit || 'PC'}
                                </div>
                            `;
                            container.appendChild(itemDiv);
                        });

                        box.style.display = 'block';
                        document.getElementById('importChildYes').checked = true;

                        // Default parent BOM level to Level 1
                        const lvlSelect = document.getElementById('bm-level');
                        if (lvlSelect) {
                            lvlSelect.value = '•|1';
                        }
                    } else {
                        hideChildPromptBox();
                    }
                })
                .catch(() => hideChildPromptBox());
        }

        function selectMasterMaterial(m) {
            // Auto fill all inputs
            document.getElementById('bm-mat-no').value = m.material_no;
            document.getElementById('bm-name').value = m.name || '';
            document.getElementById('bm-desc').value = m.description || '';
            document.getElementById('bm-model').value = m.spec_model || '';
            document.getElementById('bm-mfr').value = m.manufacturer || '';
            document.getElementById('bm-unit').value = m.unit || 'PC';
            document.getElementById('bm-drawing').value = m.drawing_no || '/';
            if (m.substitute) document.getElementById('bm-substitute').value = m.substitute;
            if (m.notes) document.getElementById('bm-notes').value = m.notes;

            // Load and display component photo
            if (m.image_path) {
                setModalImgPreview('/' + m.image_path, true);
                currentModalImgPath = m.image_path;
            } else {
                resetModalImgPreview();
            }

            // Load and display component manual
            if (m.manual_path) {
                setModalManualPreview('/' + m.manual_path, true);
                currentModalManualPath = m.manual_path;
            } else {
                resetModalManualPreview();
            }

            // Show status tags
            const tag = document.getElementById('match-status-tag');
            if (tag) {
                tag.style.display = 'inline-flex';
                tag.textContent = `已匹配物料主库: ${m.material_no}`;
            }
            const matExactHint = document.getElementById('mat-exact-hint');
            if (matExactHint) matExactHint.style.display = 'inline';

            // Clear search inputs
            const quickSearch = document.getElementById('bm-quick-search');
            if (quickSearch) quickSearch.value = `${m.material_no} ${m.name || ''}`;

            // Check and prompt if this material has child levels
            checkMaterialChildren(m.material_no);
        }

        // --- Exact Material Number Matching & Fuzzy Suggestion ---
        function handleMatNoInput(val) {
            checkExactMaterialMatch(val);
            renderFieldFuzzyDropdown('material_no', val, 'matNoFuzzyDropdown');
        }

        function handleMatNoBlur(val) {
            setTimeout(() => {
                const dd = document.getElementById('matNoFuzzyDropdown');
                if (dd) dd.style.display = 'none';
                checkExactMaterialMatch(val);
            }, 200);
        }

        function checkExactMaterialMatch(matNo) {
            const cleanNo = matNo.trim();
            const exactHint = document.getElementById('mat-exact-hint');
            const newHint = document.getElementById('mat-new-hint');
            const tag = document.getElementById('match-status-tag');

            if (!cleanNo) {
                if (exactHint) exactHint.style.display = 'none';
                if (newHint) newHint.style.display = 'none';
                if (tag) tag.style.display = 'none';
                hideChildPromptBox();
                return;
            }

            const found = allMasterMaterials.find(m => m.material_no.toLowerCase() === cleanNo.toLowerCase());
            if (found) {
                if (exactHint) exactHint.style.display = 'inline';
                if (newHint) newHint.style.display = 'none';
                if (tag) {
                    tag.style.display = 'inline-flex';
                    tag.style.background = '#dcfce7';
                    tag.style.color = '#15803d';
                    tag.textContent = `已精确匹配主库: ${found.material_no}`;
                }

                // Auto fill fields if they are empty or user is typing the exact material code
                if (!document.getElementById('bm-name').value) document.getElementById('bm-name').value = found.name || '';
                if (!document.getElementById('bm-desc').value) document.getElementById('bm-desc').value = found.description || '';
                if (!document.getElementById('bm-model').value) document.getElementById('bm-model').value = found.spec_model || '';
                if (!document.getElementById('bm-mfr').value) document.getElementById('bm-mfr').value = found.manufacturer || '';
                if (!document.getElementById('bm-unit').value) document.getElementById('bm-unit').value = found.unit || 'PC';
                const curDrawing = document.getElementById('bm-drawing').value.trim();
                if ((!curDrawing || curDrawing === '/') && found.drawing_no) {
                    document.getElementById('bm-drawing').value = found.drawing_no || '/';
                }
                if (!document.getElementById('bm-substitute').value && found.substitute) document.getElementById('bm-substitute').value = found.substitute;
                if (!document.getElementById('bm-notes').value && found.notes) document.getElementById('bm-notes').value = found.notes;

                // Display picture if present and no new local file was selected
                if (!pendingModalImgFile) {
                    if (found.image_path) {
                        setModalImgPreview('/' + found.image_path, true);
                        currentModalImgPath = found.image_path;
                    } else {
                        resetModalImgPreview();
                    }
                }

                // Display manual if present and no new local manual was selected
                if (!pendingModalManualFile) {
                    if (found.manual_path) {
                        setModalManualPreview('/' + found.manual_path, true);
                        currentModalManualPath = found.manual_path;
                    } else {
                        resetModalManualPreview();
                    }
                }
            } else {
                if (exactHint) exactHint.style.display = 'none';
                if (newHint) newHint.style.display = 'inline';
                if (tag) {
                    tag.style.display = 'inline-flex';
                    tag.style.background = '#e0f2fe';
                    tag.style.color = '#0369a1';
                    tag.textContent = '新物料（保存后同步至物料主库）';
                }
            }

            // Check and prompt if this material has child levels
            checkMaterialChildren(cleanNo);
        }


        // --- Photo Preview, Local Picker, Clipboard Paste & Drag-and-Drop ---
        function triggerModalImgPicker() {
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于锁定保护状态，不可编辑！');
                return;
            }
            removeImageFlag = false;
            document.getElementById('modalImgFileInput').click();
        }

        function applyModalImgFile(file, sourceDesc) {
            if (!file) return;
            if (!file.type || !file.type.startsWith('image/')) {
                alert('请提供有效的图片文件（PNG / JPG / JPEG / WEBP）！');
                return;
            }
            removeImageFlag = false;

            // Ensure the file has an appropriate extension
            let ext = '.png';
            if (file.type === 'image/jpeg') ext = '.jpg';
            else if (file.type === 'image/webp') ext = '.webp';

            let fileName = file.name || '';
            const hasExt = /\.(png|jpe?g|webp|emf)$/i.test(fileName);
            if (!hasExt) {
                fileName = `paste_${Date.now()}${ext}`;
            }

            pendingModalImgFile = new File([file], fileName, { type: file.type });

            const reader = new FileReader();
            reader.onload = e => {
                setModalImgPreview(e.target.result, false);
                const status = document.getElementById('modal-img-status');
                if (status) {
                    const desc = sourceDesc || '已选定本地新照片';
                    status.innerHTML = `<span style="color: #16a34a; font-weight: 600;">✓ ${desc}：</span>${escapeHtml(fileName)} <span style="color: #64748b;">(保存时将自动上传并关联)</span>`;
                    status.style.display = 'block';
                }
                const badge = document.getElementById('modal-pending-upload-badge');
                if (badge) {
                    badge.style.display = 'inline';
                    badge.textContent = (sourceDesc && sourceDesc.includes('粘贴')) ? '已粘贴新照片' : '已选新照片';
                }
                const removeBtn = document.getElementById('modal-remove-img-btn');
                if (removeBtn) removeBtn.style.display = 'inline-flex';
            };
            reader.readAsDataURL(file);
        }

        function handleModalImgSelected(event) {
            removeImageFlag = false;
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            if (window.Step3dViewer && window.Step3dViewer.is3dFile(file)) {
                window.Step3dViewer.open(file, {
                    onConfirm: (snapshotFile) => {
                        applyModalImgFile(snapshotFile, '已从3D模型生成截图');
                    }
                });
                event.target.value = '';
                return;
            }

            applyModalImgFile(file, '已选定本地照片');
        }

        async function pasteModalImgFromClipboard() {
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于锁定保护状态，无法添加或修改照片！');
                return;
            }

            // 1. Try modern navigator.clipboard.read()
            if (navigator.clipboard && navigator.clipboard.read) {
                try {
                    const clipboardItems = await navigator.clipboard.read();
                    let foundImage = false;
                    for (const item of clipboardItems) {
                        for (const type of item.types) {
                            if (type.startsWith('image/')) {
                                const blob = await item.getType(type);
                                let ext = '.png';
                                if (type.includes('jpeg') || type.includes('jpg')) ext = '.jpg';
                                else if (type.includes('webp')) ext = '.webp';
                                const file = new File([blob], `paste_${Date.now()}${ext}`, { type: blob.type || type });
                                applyModalImgFile(file, '已从剪贴板粘贴照片');
                                showPasteSuccessFeedback();
                                foundImage = true;
                                break;
                            }
                        }
                        if (foundImage) break;
                    }
                    if (foundImage) return;
                } catch (err) {
                    console.warn('navigator.clipboard.read() error:', err);
                }
            }

            alert('未在剪贴板中检测到图片！\n\n使用提示：\n1. 请先进行截图（如微信 Alt+A，或按 Win+Shift+S，或在网页/图片上右键“复制图片”）；\n2. 也可以直接在此弹窗中按键盘快捷键【Ctrl + V】完成粘贴。');
        }

        function showPasteSuccessFeedback() {
            const container = document.getElementById('modal-img-container');
            const card = document.getElementById('modal-img-card');
            if (container) {
                container.style.borderColor = '#16a34a';
                container.style.boxShadow = '0 0 0 3px rgba(22, 163, 74, 0.4)';
                setTimeout(() => {
                    container.style.borderColor = '#cbd5e1';
                    container.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
                }, 800);
            }
            if (card) {
                card.style.background = '#f0fdf4';
                setTimeout(() => {
                    card.style.background = '#f8fafc';
                }, 800);
            }
        }

        // Global Paste Listener for BOM Item Modal Photo Upload
        window.addEventListener('paste', function(e) {
            const bomModal = document.getElementById('bomItemModal');
            if (!bomModal || !bomModal.classList.contains('show')) {
                return;
            }

            if (currentProjectData && currentProjectData.is_locked == 1) {
                return;
            }

            const clipboardData = e.clipboardData || window.clipboardData;
            if (!clipboardData) return;

            let imageFile = null;

            // 1. Search in items
            if (clipboardData.items) {
                for (let i = 0; i < clipboardData.items.length; i++) {
                    const item = clipboardData.items[i];
                    if (item.type && item.type.startsWith('image/')) {
                        imageFile = item.getAsFile();
                        break;
                    }
                }
            }

            // 2. Search in files (fallback for file copied in Explorer)
            if (!imageFile && clipboardData.files && clipboardData.files.length > 0) {
                for (let i = 0; i < clipboardData.files.length; i++) {
                    const f = clipboardData.files[i];
                    if (f.type && f.type.startsWith('image/')) {
                        imageFile = f;
                        break;
                    }
                }
            }

            if (imageFile) {
                const activeEl = document.activeElement;
                const isTextInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
                const plainText = clipboardData.getData('text/plain');
                const hasText = plainText && plainText.trim().length > 0;

                // If user is editing text in an input field and there is actual text to paste, let text paste normally
                if (isTextInput && hasText) {
                    return;
                }

                e.preventDefault();
                applyModalImgFile(imageFile, '已从剪贴板粘贴照片');
                showPasteSuccessFeedback();
            }
        });

        function initModalImgDragAndDrop() {
            const container = document.getElementById('modal-img-container');
            const card = document.getElementById('modal-img-card');
            const targets = [container, card].filter(Boolean);

            targets.forEach(target => {
                target.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (currentProjectData && currentProjectData.is_locked == 1) return;
                    if (container) {
                        container.style.borderColor = '#2563eb';
                        container.style.backgroundColor = '#eff6ff';
                    }
                });

                target.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (container) {
                        container.style.borderColor = '#cbd5e1';
                        container.style.backgroundColor = '#fff';
                    }
                });

                target.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (container) {
                        container.style.borderColor = '#cbd5e1';
                        container.style.backgroundColor = '#fff';
                    }
                    if (currentProjectData && currentProjectData.is_locked == 1) return;

                    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        const file = e.dataTransfer.files[0];
                        if (file.type && file.type.startsWith('image/')) {
                            applyModalImgFile(file, '已拖拽添加新照片');
                            showPasteSuccessFeedback();
                        } else if (window.Step3dViewer && window.Step3dViewer.is3dFile(file)) {
                            window.Step3dViewer.open(file, {
                                onConfirm: (snapshotFile) => {
                                    applyModalImgFile(snapshotFile, '已从3D模型生成截图');
                                }
                            });
                        } else {
                            alert('拖拽的文件不是图片或 3D CAD 模型格式，请上传图片或 .step / .stp 文件！');
                        }
                    }
                });
            });
        }

        // --- Photo Preview & Zoom ---
        function enlargeModalImage() {
            const preview = document.getElementById('modal-img-preview');
            if (preview && preview.src && preview.style.display !== 'none') {
                showImgPreview(preview.src);
            } else {
                triggerModalImgPicker();
            }
        }

        function setModalImgPreview(src, isExisting) {
            const preview = document.getElementById('modal-img-preview');
            const placeholder = document.getElementById('modal-img-placeholder');
            const tag = document.getElementById('modal-img-tag');
            const removeBtn = document.getElementById('modal-remove-img-btn');
            const zoomHint = document.getElementById('modal-img-zoom-hint');
            const isLocked = currentProjectData && (currentProjectData.is_locked == 1);

            preview.src = src;
            preview.style.display = 'block';
            placeholder.style.display = 'none';
            if (removeBtn) removeBtn.style.display = isLocked ? 'none' : 'inline-flex';
            if (zoomHint) zoomHint.style.display = 'block';

            if (isExisting) {
                tag.style.display = 'inline';
                const status = document.getElementById('modal-img-status');
                if (status) {
                    if (isLocked) {
                        status.innerHTML = '<span style="color: #64748b;">当前已有关联照片 (工程已锁定为只读)。</span>';
                    } else {
                        status.innerHTML = '<span style="color: #0284c7; font-weight: 500;">已有关联照片。</span>可点击查看大图，或直接<b>Ctrl+V 粘贴新截图</b>/选择照片进行替换。';
                    }
                    status.style.display = 'block';
                }
                document.getElementById('modal-pending-upload-badge').style.display = 'none';
            }
        }

        function resetModalImgPreview() {
            const preview = document.getElementById('modal-img-preview');
            const placeholder = document.getElementById('modal-img-placeholder');
            const tag = document.getElementById('modal-img-tag');
            const removeBtn = document.getElementById('modal-remove-img-btn');
            const zoomHint = document.getElementById('modal-img-zoom-hint');

            preview.src = '';
            preview.style.display = 'none';
            placeholder.style.display = 'block';
            tag.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'none';
            if (zoomHint) zoomHint.style.display = 'none';
            document.getElementById('modal-pending-upload-badge').style.display = 'none';
            const status = document.getElementById('modal-img-status');
            if (status) {
                status.innerHTML = '支持本地选择、<b>快捷键 Ctrl+V 粘贴截图</b>或拖拽图片（PNG / JPG），保存时自动关联。';
                status.style.display = 'block';
            }
        }

        function removeModalImg() {
            pendingModalImgFile = null;
            currentModalImgPath = '';
            removeImageFlag = true;
            document.getElementById('modalImgFileInput').value = '';
            resetModalImgPreview();
            const status = document.getElementById('modal-img-status');
            if (status) {
                status.textContent = '已移除当前照片（保存后将从物料库解除关联）。';
                status.style.display = 'block';
            }
        }

        // --- Technical Manual Preview and Local Picker ---
        function triggerModalManualPicker() {
            removeManualFlag = false;
            document.getElementById('modalManualFileInput').click();
        }

        function handleModalManualSelected(event) {
            removeManualFlag = false;
            const file = event.target.files[0];
            if (!file) return;

            if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
                alert('请选择 PDF 格式的技术手册！');
                return;
            }

            pendingModalManualFile = file;
            setModalManualPreview(file.name, false);
            const status = document.getElementById('modal-manual-status');
            if (status) {
                status.textContent = `已选定本地新手册：${file.name}（将在保存时自动上传并关联）`;
                status.style.display = 'block';
            }
            document.getElementById('modal-pending-manual-badge').style.display = 'inline';
            document.getElementById('modal-remove-manual-btn').style.display = 'inline-flex';
            document.getElementById('modal-preview-manual-btn').style.display = 'inline-flex';
        }

        function handleModalManualClick() {
            if (pendingModalManualFile || (currentModalManualPath && !removeManualFlag)) {
                previewModalManual();
            } else {
                triggerModalManualPicker();
            }
        }

        function previewModalManual() {
            const matNo = document.getElementById('bm-mat-no').value.trim() || '物料手册';
            const matName = document.getElementById('bm-name').value.trim() || '';

            if (pendingModalManualFile) {
                const blobUrl = URL.createObjectURL(pendingModalManualFile);
                previewManualOnline(blobUrl, matNo, matName);
            } else if (currentModalManualPath && !removeManualFlag) {
                previewManualOnline('/' + currentModalManualPath, matNo, matName);
            } else {
                triggerModalManualPicker();
            }
        }

        function setModalManualPreview(pathOrName, isExisting) {
            const icon = document.getElementById('modal-manual-icon');
            const fname = document.getElementById('modal-manual-filename');
            const placeholder = document.getElementById('modal-manual-placeholder');
            const tag = document.getElementById('modal-manual-tag');
            const removeBtn = document.getElementById('modal-remove-manual-btn');
            const previewBtn = document.getElementById('modal-preview-manual-btn');
            const zoomHint = document.getElementById('modal-manual-zoom-hint');

            let displayName = '';
            if (typeof pathOrName === 'string') {
                const parts = pathOrName.split('/');
                displayName = parts[parts.length - 1];
            } else {
                displayName = '技术手册.pdf';
            }

            if (icon) icon.style.display = 'block';
            if (fname) {
                fname.textContent = displayName;
                fname.style.display = 'block';
            }
            if (placeholder) placeholder.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'inline-flex';
            if (previewBtn) previewBtn.style.display = 'inline-flex';
            if (zoomHint) zoomHint.style.display = 'block';

            if (isExisting) {
                if (tag) tag.style.display = 'inline';
                const status = document.getElementById('modal-manual-status');
                if (status) {
                    status.textContent = '';
                    status.style.display = 'none';
                }
                const badge = document.getElementById('modal-pending-manual-badge');
                if (badge) badge.style.display = 'none';
            }
        }

        function resetModalManualPreview() {
            const icon = document.getElementById('modal-manual-icon');
            const fname = document.getElementById('modal-manual-filename');
            const placeholder = document.getElementById('modal-manual-placeholder');
            const tag = document.getElementById('modal-manual-tag');
            const removeBtn = document.getElementById('modal-remove-manual-btn');
            const previewBtn = document.getElementById('modal-preview-manual-btn');
            const zoomHint = document.getElementById('modal-manual-zoom-hint');

            if (icon) icon.style.display = 'none';
            if (fname) {
                fname.textContent = '';
                fname.style.display = 'none';
            }
            if (placeholder) placeholder.style.display = 'block';
            if (tag) tag.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'none';
            if (previewBtn) previewBtn.style.display = 'none';
            if (zoomHint) zoomHint.style.display = 'none';

            const badge = document.getElementById('modal-pending-manual-badge');
            if (badge) badge.style.display = 'none';
            const status = document.getElementById('modal-manual-status');
            if (status) {
                status.textContent = '支持从本地关联技术手册（PDF 格式），可在系统内直接查阅。保存时同步至物料数据库。';
                status.style.display = 'block';
            }
            const fileInput = document.getElementById('modalManualFileInput');
            if (fileInput) fileInput.value = '';
        }

        function removeModalManual() {
            pendingModalManualFile = null;
            currentModalManualPath = '';
            removeManualFlag = true;
            const fileInput = document.getElementById('modalManualFileInput');
            if (fileInput) fileInput.value = '';
            resetModalManualPreview();
            const status = document.getElementById('modal-manual-status');
            if (status) {
                status.textContent = '已移除当前手册（保存后将从物料库解除关联）。';
                status.style.display = 'block';
            }
        }


        // --- Subsystem Sheet Management ---
        function addNewSubsystemSheet() {
            if (!currentProjectId) return;
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法新建Sheet！如需编辑请先点击【解锁编辑】。');
                return;
            }
            const sheetName = prompt('请输入新Sheet名称:');
            if (!sheetName || !sheetName.trim()) return;

            fetch('/api/subsystem/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project_id: currentProjectId, name: sheetName.trim() })
            }).then(r => r.json()).then(res => {
                if (res.success) {
                    loadProject(currentProjectId, res.id);
                } else {
                    alert(res.error || '添加失败');
                }
            });
        }

        function deleteCurrentSubsystemSheet() {
            if (!currentSubsystemId || !currentProjectData || !currentProjectData.subsystems) return;
            if (currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法删除Sheet！如需编辑请先点击【解锁编辑】。');
                return;
            }
            const currentSub = currentProjectData.subsystems.find(s => s.id === currentSubsystemId);
            const name = currentSub ? currentSub.name : '此Sheet';

            if (confirm(`确定要删除 "${name}" 及其包含的所有物料行吗？\n注意：此操作不可撤销！`)) {
                fetch('/api/subsystem/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: currentSubsystemId })
                }).then(r => r.json()).then(res => {
                    if (res.success) {
                        alert(`已成功删除 "${name}"`);
                        loadProject(currentProjectId);
                    } else {
                        alert(res.error || '删除失败');
                    }
                });
            }
        }

        function renameCurrentSubsystemSheet() {
            if (!currentSubsystemId || !currentProjectData || !currentProjectData.subsystems) return;
            if (currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法重命名Sheet！如需编辑请先点击【解锁编辑】。');
                return;
            }
            const currentSub = currentProjectData.subsystems.find(s => s.id === currentSubsystemId);
            const oldName = currentSub ? currentSub.name : '';
            const newName = prompt('请输入新的Sheet名称:', oldName);
            if (!newName || !newName.trim() || newName.trim() === oldName) return;

            fetch('/api/subsystem/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: currentSubsystemId, name: newName.trim() })
            }).then(r => r.json()).then(res => {
                if (res.success) {
                    loadProject(currentProjectId, currentSubsystemId);
                } else {
                    alert(res.error || '重命名失败');
                }
            });
        }

        function copyCurrentSubsystemSheet() {
            if (!currentSubsystemId || !currentProjectData || !currentProjectData.subsystems) return;
            if (currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法复制Sheet！如需编辑请先在顶部点击【解锁】。');
                return;
            }
            const currentSub = currentProjectData.subsystems.find(s => s.id === currentSubsystemId);
            const origName = currentSub ? currentSub.name : 'Sheet';

            // Generate default name: "xxx - 副本"
            let defaultName = `${origName} - 副本`;
            let suffix = 2;
            const existingNames = new Set(currentProjectData.subsystems.map(s => s.name));
            while (existingNames.has(defaultName)) {
                defaultName = `${origName} - 副本 (${suffix})`;
                suffix++;
            }

            const newName = prompt(`请输入复制出的新 Sheet 名称：\n（将完整复制【${origName}】及其所有 BOM 物料明细）`, defaultName);
            if (!newName || !newName.trim()) return;

            const trimmedName = newName.trim();
            if (existingNames.has(trimmedName)) {
                alert(`Sheet 名称【${trimmedName}】已存在，请换一个名称！`);
                return;
            }

            safeFetchJson('/api/subsystem/copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: currentSubsystemId, name: trimmedName })
            })
            .then(res => {
                if (res && res.success) {
                    showToast(res.message || `已成功复制 Sheet【${trimmedName}】！`, 'success');
                    // Reload project and switch directly to the newly created sheet
                    loadProject(currentProjectId, res.new_id);
                } else {
                    alert((res && res.error) || '复制 Sheet 失败');
                }
            })
            .catch(err => {
                alert('复制 Sheet 发生错误: ' + err.message);
            });
        }

        // --- Add / Edit Modal Controls ---
        function openAddBomModal() {
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法添加物料！如需编辑请先在顶部点击【解锁编辑】。');
                return;
            }
            const btnSave = document.getElementById('btnSaveBomItem');
            if (btnSave) btnSave.style.display = '';

            document.getElementById('bomModalTitle').textContent = '添加物料明细';
            document.getElementById('edit-bom-id').value = '';
            const masterGroup = document.getElementById('masterSelectGroup');
            if (masterGroup) masterGroup.style.display = '';
            document.getElementById('insertPosGroup').style.display = 'block';
            const quickSearch = document.getElementById('bm-quick-search');
            if (quickSearch) quickSearch.value = '';
            const matchTag = document.getElementById('match-status-tag');
            if (matchTag) matchTag.style.display = 'none';
            document.getElementById('mat-exact-hint').style.display = 'none';
            document.getElementById('mat-new-hint').style.display = 'none';
            hideChildPromptBox();
            closeAllFuzzyDropdowns();

            document.getElementById('bm-mat-no').value = '';
            document.getElementById('bm-name').value = '';
            document.getElementById('bm-desc').value = '';
            document.getElementById('bm-model').value = '';
            document.getElementById('bm-mfr').value = '';
            document.getElementById('bm-qty').value = '1';
            document.getElementById('bm-unit').value = 'PC';
            document.getElementById('bm-drawing').value = '/';
            document.getElementById('bm-substitute').value = '';
            document.getElementById('bm-notes').value = '';

            pendingModalImgFile = null;
            currentModalImgPath = '';
            removeImageFlag = false;
            resetModalImgPreview();

            pendingModalManualFile = null;
            currentModalManualPath = '';
            removeManualFlag = false;
            resetModalManualPreview();

            // Populate insertion positions
            const posSelect = document.getElementById('bm-insert-pos');
            posSelect.innerHTML = '<option value="end">追加到表格末尾</option><option value="start">插入到表格开头 (作为第 1 行)</option>';
            currentBomItems.forEach(it => {
                const opt = document.createElement('option');
                opt.value = it.row_num;
                opt.textContent = `插入在第 ${it.row_num} 行之后 (${it.material_no} ${it.m_name || ''})`;
                posSelect.appendChild(opt);
            });

            // Default insert position to after the selected row if a row is currently highlighted
            if (selectedRowId !== null) {
                const selItem = currentBomItems.find(it => it.id === selectedRowId);
                if (selItem && selItem.row_num) {
                    posSelect.value = selItem.row_num;
                }
            }

            const btnPickImg = document.getElementById('modal-pick-img-btn');
            if (btnPickImg) btnPickImg.style.display = 'inline-flex';
            const btnPasteImg = document.getElementById('modal-paste-img-btn');
            if (btnPasteImg) btnPasteImg.style.display = 'inline-flex';

            openModal('bomItemModal');
        }

        function openEditBomModal(target) {
            let it = null;
            if (target && typeof target === 'object') {
                it = target;
            } else if (target !== undefined && target !== null) {
                // 1. 优先按 BOM 行唯一 ID 精确匹配（筛选、排序、折叠后依然 100% 精准对应）
                it = (currentBomItems || []).find(item => item.id == target);
                // 2. 兼容性兜底：若未按 ID 命中且传入为下标数值，按下标寻址
                if (!it && typeof target === 'number' && target >= 0 && target < (currentBomItems || []).length) {
                    it = currentBomItems[target];
                }
            }

            if (!it) {
                showToast('未找到对应的物料明细行数据', 'error');
                return;
            }
            const isLocked = currentProjectData && (currentProjectData.is_locked == 1);
            const btnSave = document.getElementById('btnSaveBomItem');
            const btnPickImg = document.getElementById('modal-pick-img-btn');
            const btnPasteImg = document.getElementById('modal-paste-img-btn');

            if (isLocked) {
                document.getElementById('bomModalTitle').textContent = `查看物料明细 (第 ${it.row_num} 行 - 只读保护)`;
                if (btnSave) btnSave.style.display = 'none';
                if (btnPickImg) btnPickImg.style.display = 'none';
                if (btnPasteImg) btnPasteImg.style.display = 'none';
            } else {
                document.getElementById('bomModalTitle').textContent = `编辑物料明细 (第 ${it.row_num} 行)`;
                if (btnSave) btnSave.style.display = '';
                if (btnPickImg) btnPickImg.style.display = 'inline-flex';
                if (btnPasteImg) btnPasteImg.style.display = 'inline-flex';
            }

            document.getElementById('edit-bom-id').value = it.id;
            const masterGroup = document.getElementById('masterSelectGroup');
            if (masterGroup) masterGroup.style.display = 'none';
            document.getElementById('insertPosGroup').style.display = 'none';
            const quickSearch = document.getElementById('bm-quick-search');
            if (quickSearch) quickSearch.value = '';
            const matchTag = document.getElementById('match-status-tag');
            if (matchTag) matchTag.style.display = 'none';
            document.getElementById('mat-exact-hint').style.display = 'none';
            document.getElementById('mat-new-hint').style.display = 'none';
            hideChildPromptBox();
            closeAllFuzzyDropdowns();

            document.getElementById('bm-mat-no').value = it.material_no;
            document.getElementById('bm-name').value = it.m_name || '';
            document.getElementById('bm-desc').value = it.m_desc || '';
            document.getElementById('bm-model').value = it.m_model || '';
            document.getElementById('bm-mfr').value = it.m_mfr || '';
            document.getElementById('bm-qty').value = it.qty;
            document.getElementById('bm-unit').value = it.unit || it.m_unit || 'PC';
            document.getElementById('bm-drawing').value = it.drawing_no || '/';
            document.getElementById('bm-substitute').value = it.substitute || it.m_substitute || '';
            document.getElementById('bm-notes').value = it.notes || '';
            document.getElementById('bm-level').value = `${it.level_str}|${it.level_num}`;

            pendingModalImgFile = null;
            currentModalImgPath = it.image_path || '';
            removeImageFlag = false;

            if (it.image_path) {
                setModalImgPreview('/' + it.image_path, true);
            } else {
                resetModalImgPreview();
            }

            pendingModalManualFile = null;
            currentModalManualPath = it.manual_path || '';
            removeManualFlag = false;

            if (it.manual_path) {
                setModalManualPreview('/' + it.manual_path, true);
            } else {
                resetModalManualPreview();
            }

            checkExactMaterialMatch(it.material_no);
            openModal('bomItemModal');
        }

        async function submitBomItem() {
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法保存物料修改！如需编辑请先在顶部点击【解锁编辑】。');
                return;
            }
            const editId = document.getElementById('edit-bom-id').value;
            const matNo = document.getElementById('bm-mat-no').value.trim();
            if (!matNo) {
                alert('请填写物料号！');
                return;
            }

            // If a local image was picked, upload it first
            if (pendingModalImgFile) {
                const fd = new FormData();
                fd.append('file', pendingModalImgFile);
                fd.append('material_no', matNo);
                try {
                    await fetch('/api/upload/image', { method: 'POST', body: fd });
                } catch (e) {
                    console.error('Image upload failed:', e);
                }
            }

            // If a local manual (PDF) was picked, upload it first
            if (pendingModalManualFile) {
                const fdManual = new FormData();
                fdManual.append('file', pendingModalManualFile);
                fdManual.append('material_no', matNo);
                try {
                    await fetch('/api/upload/manual', { method: 'POST', body: fdManual });
                } catch (e) {
                    console.error('Manual upload failed:', e);
                }
            }

            const [lvlStr, lvlNum] = document.getElementById('bm-level').value.split('|');
            const isAdd = !editId;
            let importChildren = false;
            if (isAdd && currentMaterialChildren && currentMaterialChildren.length > 0) {
                const optYes = document.getElementById('importChildYes');
                importChildren = (optYes && optYes.checked);
            }

            const payload = {
                subsystem_id: currentSubsystemId,
                material_no: matNo,
                m_name: document.getElementById('bm-name').value.trim(),
                name: document.getElementById('bm-name').value.trim(),
                m_desc: document.getElementById('bm-desc').value.trim(),
                description: document.getElementById('bm-desc').value.trim(),
                m_model: document.getElementById('bm-model').value.trim(),
                spec_model: document.getElementById('bm-model').value.trim(),
                m_mfr: document.getElementById('bm-mfr').value.trim(),
                manufacturer: document.getElementById('bm-mfr').value.trim(),
                qty: document.getElementById('bm-qty').value,
                unit: document.getElementById('bm-unit').value.trim(),
                drawing_no: document.getElementById('bm-drawing').value.trim(),
                notes: document.getElementById('bm-notes').value.trim(),
                substitute: document.getElementById('bm-substitute').value.trim(),
                level_str: lvlStr,
                level_num: lvlNum,
                remove_image: removeImageFlag,
                remove_manual: removeManualFlag,
                import_children: importChildren
            };

            let url = '/api/bom/add';
            if (editId) {
                url = '/api/bom/update';
                payload.id = editId;
            } else {
                payload.insert_after_row = document.getElementById('bm-insert-pos').value;
            }

            safeFetchJson(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(res => {
                if (res.success) {
                    pendingModalImgFile = null;
                    removeImageFlag = false;
                    currentModalImgPath = '';
                    pendingModalManualFile = null;
                    removeManualFlag = false;
                    currentModalManualPath = '';
                    closeModal('bomItemModal');
                    loadBomItems(currentSubsystemId);
                    loadMasterMaterials();
                    if (typeof refreshCurrentProjectUpdatedAt === 'function') refreshCurrentProjectUpdatedAt();
                    if (res.imported_children_count > 0) {
                        showToast(`总成 [${res.material_no}] 及其下属全部 ${res.imported_children_count} 项子零部件已导入。`, 'success');
                    } else if (res.is_new_material) {
                        showToast(`物料 [${res.material_no}] 已添加并同步至物料主库。`, 'success');
                    } else {
                        showToast(res.message || '保存成功。', 'success');
                    }
                } else {
                    alert(res.error || '保存失败');
                }
            }).catch(err => {
                alert('提交失败: ' + err.message);
            });
        }


        // ==========================================
        // Batch Add BOM Items Functionality
        // ==========================================
        let batchParsedItems = [];
        let batchCustomQtyMap = new Map();

        function openBatchAddBomModal() {
            if (!currentProjectId || !currentSubsystemId) {
                alert('请先选择并打开一个工程项目及 Sheet 子系统！');
                return;
            }
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法批量添加物料！如需编辑请先在顶部点击【解锁编辑】。');
                return;
            }

            batchParsedItems = [];
            batchCustomQtyMap.clear();

            // Reset inputs
            const textEl = document.getElementById('batch-mat-text');
            if (textEl) textEl.value = '';

            const lvlSelect = document.getElementById('batch-bm-level');
            if (lvlSelect) lvlSelect.value = '••|2'; // default Level 2

            const qtyEl = document.getElementById('batch-bm-qty');
            if (qtyEl) qtyEl.value = '1';

            const unitEl = document.getElementById('batch-bm-unit');
            if (unitEl) unitEl.value = 'PC';

            const dedupEl = document.getElementById('batch-opt-dedup');
            if (dedupEl) dedupEl.checked = false;

            // Populate insertion positions
            const posSelect = document.getElementById('batch-insert-pos');
            if (posSelect) {
                posSelect.innerHTML = '<option value="end">追加到表格末尾</option><option value="start">插入到表格开头 (作为第 1 行)</option>';
                (currentBomItems || []).forEach(it => {
                    const opt = document.createElement('option');
                    opt.value = it.row_num;
                    opt.textContent = `插入在第 ${it.row_num} 行之后 (${it.material_no} ${it.m_name || ''})`;
                    posSelect.appendChild(opt);
                });

                // Default insert position to after the selected row if a row is currently highlighted
                if (selectedRowId !== null) {
                    const selItem = (currentBomItems || []).find(it => it.id === selectedRowId);
                    if (selItem && selItem.row_num) {
                        posSelect.value = selItem.row_num;
                    }
                }
            }

            onBatchTextOrConfigChanged();
            openModal('batchAddBomModal');

            setTimeout(() => {
                if (textEl) textEl.focus();
            }, 100);
        }

        function clearBatchInput() {
            batchCustomQtyMap.clear();
            batchParsedItems = [];
            const textEl = document.getElementById('batch-mat-text');
            if (textEl) {
                textEl.value = '';
                textEl.focus();
            }
            renderBatchPreview();
        }

        function parseBatchInputFromText() {
            const textEl = document.getElementById('batch-mat-text');
            const rawText = textEl ? textEl.value : '';
            if (!rawText.trim()) return [];

            const defaultQty = (document.getElementById('batch-bm-qty')?.value || '1').trim() || '1';
            const defaultUnit = (document.getElementById('batch-bm-unit')?.value || 'PC').trim() || 'PC';
            const doDedup = document.getElementById('batch-opt-dedup')?.checked || false;

            const lines = rawText.split(/\r?\n/);
            const items = [];
            const seen = new Set();

            for (let line of lines) {
                line = line.trim();
                if (!line) continue;

                // Support plain material_no per line and Excel TSV columns (e.g., mat_no \t qty \t unit)
                const parts = line.split(/[\t,;]|\s{2,}/).map(s => s.trim()).filter(Boolean);
                const matNo = (parts[0] || '').trim();
                if (!matNo) continue;

                const lowerKey = matNo.toLowerCase();
                if (doDedup) {
                    if (seen.has(lowerKey)) continue;
                    seen.add(lowerKey);
                }

                let qty = defaultQty;
                let unit = defaultUnit;

                // If line explicitly contains quantity, e.g. "DFB00014350  2  PC"
                if (parts.length > 1 && !isNaN(parseFloat(parts[1]))) {
                    qty = parts[1];
                } else if (batchCustomQtyMap.has(lowerKey)) {
                    // Retain user's custom adjusted quantity in preview table
                    qty = batchCustomQtyMap.get(lowerKey);
                }

                if (parts.length > 2 && parts[2]) {
                    unit = parts[2];
                }

                items.push({ material_no: matNo, qty, unit });
            }

            return items;
        }

        function onBatchTextOrConfigChanged() {
            batchParsedItems = parseBatchInputFromText();
            renderBatchPreview();
        }

        function handleBatchItemQtyChange(idx, newVal) {
            if (!batchParsedItems[idx]) return;
            const cleanedVal = newVal.trim() || '1';
            batchParsedItems[idx].qty = cleanedVal;
            const matKey = batchParsedItems[idx].material_no.toLowerCase();
            batchCustomQtyMap.set(matKey, cleanedVal);
        }

        function removeBatchItem(idx) {
            if (!batchParsedItems[idx]) return;
            const targetMatNo = batchParsedItems[idx].material_no;
            batchCustomQtyMap.delete(targetMatNo.toLowerCase());
            batchParsedItems.splice(idx, 1);

            // Synchronize back to textarea
            const textEl = document.getElementById('batch-mat-text');
            if (textEl) {
                textEl.value = batchParsedItems.map(it => {
                    return (it.qty && it.qty !== '1') ? `${it.material_no}\t${it.qty}` : it.material_no;
                }).join('\n');
            }

            renderBatchPreview();
        }

        function renderBatchPreview() {
            const items = batchParsedItems;
            const tbody = document.getElementById('batchPreviewTableBody');
            const summaryEl = document.getElementById('batchPreviewSummary');
            const badgeMatched = document.getElementById('badgeMatchedCount');
            const badgeNew = document.getElementById('badgeNewCount');
            const footerCountEl = document.getElementById('batchFooterCount');
            const submitBtn = document.getElementById('btnSubmitBatchAdd');

            if (!items || items.length === 0) {
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="7" style="padding: 28px; text-align: center; color: #94a3b8; font-size: 13px;">请在上方粘贴或输入物料号后查看解析预览</td></tr>`;
                }
                if (summaryEl) summaryEl.textContent = '(暂无有效输入)';
                if (badgeMatched) badgeMatched.style.display = 'none';
                if (badgeNew) badgeNew.style.display = 'none';
                if (footerCountEl) footerCountEl.textContent = '0';
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = '确认批量导入';
                }
                return;
            }

            let matchedCount = 0;
            let newCount = 0;
            const rowsHtml = items.map((it, idx) => {
                const cleanNo = it.material_no.toLowerCase();
                const master = (allMasterMaterials || []).find(m => (m.material_no || '').toLowerCase() === cleanNo);
                const isMatched = !!master;
                if (isMatched) matchedCount++;
                else newCount++;

                const nameText = isMatched ? (master.name || master.description || '-') : '<span style="color: #64748b; font-style: italic;">新物料 (导入后可补充)</span>';
                const modelText = isMatched ? [master.spec_model, master.manufacturer].filter(Boolean).join(' / ') || '-' : '-';
                const statusBadge = isMatched 
                    ? '<span style="display: inline-block; padding: 2px 6px; background: #dcfce7; color: #166534; border-radius: 4px; font-size: 11px; font-weight: 600;">已匹配主库</span>'
                    : '<span style="display: inline-block; padding: 2px 6px; background: #e0f2fe; color: #0284c7; border-radius: 4px; font-size: 11px; font-weight: 600;">新物料</span>';

                return `
                    <tr style="border-bottom: 1px solid #f1f5f9; ${idx % 2 === 1 ? 'background: #fbfcfe;' : ''}">
                        <td style="padding: 6px 8px; color: #94a3b8; font-family: monospace; text-align: center;">${idx + 1}</td>
                        <td style="padding: 6px 10px; font-weight: 600; font-family: monospace; color: #0f172a;">${escapeHtml(it.material_no)}</td>
                        <td style="padding: 6px 10px; color: #334155;">${nameText}</td>
                        <td style="padding: 6px 10px; color: #64748b;">${escapeHtml(modelText)}</td>
                        <td style="padding: 4px 8px;">
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <input type="number" 
                                       step="any" 
                                       min="0.001" 
                                       class="form-input" 
                                       style="width: 70px; padding: 2px 6px; font-size: 12px; height: 26px; text-align: right; font-weight: 600; font-family: monospace; border-color: #93c5fd; background: #fff;" 
                                       value="${escapeHtml(it.qty)}" 
                                       oninput="handleBatchItemQtyChange(${idx}, this.value)" 
                                       title="可直接修改该物料的导入数量">
                                <span style="font-size: 11px; color: #64748b;">${escapeHtml(it.unit || 'PC')}</span>
                            </div>
                        </td>
                        <td style="padding: 6px 10px; text-align: center;">${statusBadge}</td>
                        <td style="padding: 4px 6px; text-align: center;">
                            <button type="button" class="btn btn-outline btn-sm" style="padding: 1px 6px; font-size: 11px; color: #ef4444; border-color: #fca5a5; line-height: 1.2;" onclick="removeBatchItem(${idx})" title="移出此行">&times;</button>
                        </td>
                    </tr>
                `;
            }).join('');

            if (tbody) tbody.innerHTML = rowsHtml;
            if (summaryEl) summaryEl.textContent = `(已解析 ${items.length} 行物料号，可在下方直接调整数量)`;
            if (badgeMatched) {
                badgeMatched.textContent = `已匹配主库: ${matchedCount}`;
                badgeMatched.style.display = matchedCount > 0 ? 'inline-block' : 'none';
            }
            if (badgeNew) {
                badgeNew.textContent = `新物料: ${newCount}`;
                badgeNew.style.display = newCount > 0 ? 'inline-block' : 'none';
            }
            if (footerCountEl) footerCountEl.textContent = items.length;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = `确认批量导入 (${items.length} 项)`;
            }
        }

        let isSubmittingBatchAdd = false;
        async function submitBatchBomAdd() {
            if (isSubmittingBatchAdd) return;
            if (!currentProjectId || !currentSubsystemId) {
                alert('请先选择工程项目及 Sheet 子系统！');
                return;
            }
            if (currentProjectData && currentProjectData.is_locked == 1) {
                alert('当前工程处于【锁定保护】状态，无法批量导入物料！如需编辑请先在顶部点击【解锁编辑】。');
                return;
            }

            if (!batchParsedItems || batchParsedItems.length === 0) {
                alert('请先在输入框中粘贴或输入至少一个有效物料号！');
                const textEl = document.getElementById('batch-mat-text');
                if (textEl) textEl.focus();
                return;
            }

            const submitBtn = document.getElementById('btnSubmitBatchAdd');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = `正在导入 ${batchParsedItems.length} 项物料...`;
            }
            isSubmittingBatchAdd = true;

            const [lvlStr, lvlNum] = (document.getElementById('batch-bm-level')?.value || '••|2').split('|');
            const insertPos = document.getElementById('batch-insert-pos')?.value || 'end';
            const defaultQty = (document.getElementById('batch-bm-qty')?.value || '1').trim() || '1';
            const defaultUnit = (document.getElementById('batch-bm-unit')?.value || 'PC').trim() || 'PC';

            const payload = {
                subsystem_id: currentSubsystemId,
                level_str: lvlStr,
                level_num: parseInt(lvlNum),
                insert_after_row: insertPos,
                default_qty: defaultQty,
                default_unit: defaultUnit,
                items: batchParsedItems
            };

            try {
                const res = await safeFetchJson('/api/bom/batch_add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res && res.success) {
                    closeModal('batchAddBomModal');
                    showToast(res.message || `已成功批量导入 ${res.imported_count || batchParsedItems.length} 项物料！`, 'success');
                    loadBomItems(currentSubsystemId);
                    if (typeof refreshCurrentProjectUpdatedAt === 'function') refreshCurrentProjectUpdatedAt();
                    if (res.new_materials_count > 0) {
                        loadMasterMaterials();
                        loadMasterStats();
                    }
                } else {
                    alert((res && res.error) || '批量导入失败，请检查输入');
                }
            } catch (err) {
                alert('批量导入异常: ' + (err.message || '网络连接异常'));
            } finally {
                isSubmittingBatchAdd = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '确认批量导入';
                }
            }
        }


        // --- Upload Handlers ---
        function triggerImgUpload(matNo) {
            uploadTargetMatNo = matNo;
            document.getElementById('singleImgUploadInput').click();
        }

        function handleSingleImgUpload(event) {
            const file = event.target.files[0];
            if (!file || !uploadTargetMatNo) return;

            // Check if 3D CAD model file (.step / .stp / etc.)
            if (window.Step3dViewer && window.Step3dViewer.is3dFile(file)) {
                const targetMatNo = uploadTargetMatNo;
                window.Step3dViewer.open(file, {
                    onConfirm: async (snapshotFile) => {
                        await window.Step3dViewer.uploadSnapshotForMaterial(snapshotFile, targetMatNo);
                    }
                });
                event.target.value = '';
                return;
            }

            const formData = new FormData();
            formData.append('file', file);
            formData.append('material_no', uploadTargetMatNo);

            fetch('/api/upload/image', { method: 'POST', body: formData })
                .then(r => r.json())
                .then(res => {
                    if (res.success) {
                        loadBomItems(currentSubsystemId);
                        loadMasterMaterials();
                    } else {
                        alert(res.error || '上传图片失败');
                    }
                });
        }

        function triggerManualUpload(matNo) {
            uploadTargetMatNo = matNo;
            document.getElementById('singleManualUploadInput').click();
        }

        function handleSingleManualUpload(event) {
            const file = event.target.files[0];
            if (!file || !uploadTargetMatNo) return;
            const formData = new FormData();
            formData.append('file', file);
            formData.append('material_no', uploadTargetMatNo);

            fetch('/api/upload/manual', { method: 'POST', body: formData })
                .then(r => r.json())
                .then(res => {
                    if (res.success) {
                        loadBomItems(currentSubsystemId);
                        loadMasterMaterials();
                    } else {
                        alert(res.error || '上传手册失败');
                    }
                });
        }

        // --- Image Preview ---
        function showImgPreview(src) {
            document.getElementById('previewImgTag').src = src;
            openModal('imgPreviewModal');
        }

        // Close fuzzy dropdowns on clicking outside or pressing Escape
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.fuzzy-dropdown')) {
                document.querySelectorAll('#bomItemModal .fuzzy-dropdown').forEach(d => {
                    const formGroup = d.closest('.form-group');
                    if (!formGroup || !formGroup.contains(e.target)) {
                        d.style.display = 'none';
                    }
                });
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllFuzzyDropdowns();
            }
        });


