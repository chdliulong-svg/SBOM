// ==========================================
// Service BOM - Master Materials Hub & Hierarchy
// ==========================================

        let masterSearchDebounceTimer = null;
        let hierFuzzyDebounceTimer = null;

        // Master Materials Table & Selection State (allMasterMaterials declared in core.js)
        let rawMasterMaterialsOrder = [];
        let masterCurrentSortField = null;
        let masterCurrentSortDir = 'none'; // 'none', 'asc', 'desc'
        let selectedMasterMatNos = new Set();

        const MASTER_SORT_FIELD_LABELS = {
            material_no: '物料号',
            name: '元器件名称',
            referenced_projects: '引用项目',
            description: '物料完整描述',
            spec_model: '规格型号',
            manufacturer: '制造商',
            unit: '单位',
            drawing_no: '图纸/代号',
            image_path: '实物图片',
            manual_path: '技术手册'
        };

        function handleMasterSearchInput(val) {
            clearTimeout(masterSearchDebounceTimer);
            masterSearchDebounceTimer = setTimeout(() => {
                loadMasterMaterials();
            }, 250);
        }

        function filterMasterByStatus(status) {
            const sel = document.getElementById('masterFilterType');
            if (sel) {
                sel.value = status;
                loadMasterMaterials();
            }
        }

        function loadMasterStats() {
            fetch('/api/materials/stats')
                .then(r => r.json())
                .then(stats => {
                    const elTotal = document.getElementById('stat-total');
                    const elRef = document.getElementById('stat-referenced');
                    const elChildren = document.getElementById('stat-children');
                    const elImages = document.getElementById('stat-images');
                    const elManuals = document.getElementById('stat-manuals');

                    if (elTotal) elTotal.textContent = stats.total_materials || 0;
                    if (elRef) elRef.textContent = stats.referenced_count || 0;
                    if (elChildren) elChildren.textContent = stats.assemblies_count || 0;
                    if (elImages) elImages.textContent = stats.images_count || 0;
                    if (elManuals) elManuals.textContent = stats.manuals_count || 0;
                })
                .catch(err => console.error('Error loading master stats:', err));
        }

        function toggleMasterStats(forceShow = null) {
            const banner = document.getElementById('masterStatsBanner');
            const btn = document.getElementById('btnMasterStatsToggle');
            if (!banner) return;

            const isVisible = banner.style.display !== 'none';
            const show = forceShow !== null ? forceShow : !isVisible;

            if (show) {
                banner.style.display = 'grid';
                if (btn) {
                    btn.style.borderColor = '#2563eb';
                    btn.style.color = '#1d4ed8';
                    btn.style.background = '#eff6ff';
                }
            } else {
                banner.style.display = 'none';
                if (btn) {
                    btn.style.borderColor = '';
                    btn.style.color = '';
                    btn.style.background = '';
                }
            }
        }

        function loadMasterMaterials(searchQuery = null) {
            if (searchQuery !== null) {
                const sInput = document.getElementById('masterSearch');
                if (sInput) sInput.value = searchQuery;
            }
            const search = document.getElementById('masterSearch') ? document.getElementById('masterSearch').value.trim() : '';
            const filterType = document.getElementById('masterFilterType') ? document.getElementById('masterFilterType').value : 'all';

            fetch(`/api/materials?q=${encodeURIComponent(search)}&filter_type=${encodeURIComponent(filterType)}`)
                .then(r => r.json())
                .then(materials => {
                    const list = Array.isArray(materials) ? materials : [];
                    rawMasterMaterialsOrder = [...list];
                    allMasterMaterials = [...list];

                    // Prune selection: retain items that still exist
                    const validNos = new Set(allMasterMaterials.map(m => m.material_no));
                    for (const no of selectedMasterMatNos) {
                        if (!validNos.has(no)) {
                            selectedMasterMatNos.delete(no);
                        }
                    }

                    // Apply active column sorting
                    if (masterCurrentSortField && masterCurrentSortDir !== 'none') {
                        applyMasterSortList();
                    }

                    populateMasterDatalists();
                    renderMasterMaterialsTable();
                })
                .catch(err => console.error('Error loading master materials:', err));
        }

        function populateMasterDatalists() {
            const models = new Set();
            const mfrs = new Set();
            const names = new Set();
            (allMasterMaterials || []).forEach(m => {
                if (m.spec_model && m.spec_model.trim() && m.spec_model.trim() !== '/') {
                    models.add(m.spec_model.trim());
                }
                if (m.manufacturer && m.manufacturer.trim() && m.manufacturer.trim() !== '/') {
                    mfrs.add(m.manufacturer.trim());
                }
                if (m.name && m.name.trim() && m.name.trim() !== '/') {
                    names.add(m.name.trim());
                }
            });
            const fill = (id, set) => {
                const dl = document.getElementById(id);
                if (!dl) return;
                dl.innerHTML = Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base' })).map(v => `<option value="${escapeHtml(v)}">`).join('');
            };
            fill('mm-models-datalist', models);
            fill('mm-mfrs-datalist', mfrs);
            fill('mm-names-datalist', names);
        }
        window.populateMasterDatalists = populateMasterDatalists;

        function renderMasterMaterialsTable() {
            const tbody = document.getElementById('masterTableBody');
            if (!tbody) return;

            tbody.innerHTML = '';
            if (!allMasterMaterials || allMasterMaterials.length === 0) {
                tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 40px;">未找到匹配的通用物料</td></tr>`;
                applyColumnWidths('masterTable');
                updateMasterToolbarState();
                return;
            }

            allMasterMaterials.forEach(m => {
                const isSelected = selectedMasterMatNos.has(m.material_no);
                const tr = document.createElement('tr');
                if (isSelected) {
                    tr.className = 'master-row-selected';
                }
                tr.ondblclick = () => openEditMasterModal(m.material_no);
                tr.onclick = (e) => handleMasterRowClick(e, m.material_no);
                tr.title = '双击编辑该物料 · 单击勾选行';

                // Checkbox cell (replaces old action column)
                const selectCellHtml = `
                    <td class="col-center" onclick="event.stopPropagation()">
                        <input type="checkbox" class="master-row-cb" value="${escapeHtml(m.material_no)}" ${isSelected ? 'checked' : ''} onchange="toggleMasterRowSelect('${escapeHtml(m.material_no)}', this.checked)" style="cursor: pointer; width: 14px; height: 14px; margin: 0; vertical-align: middle;">
                    </td>`;

                // Image cell
                let imgTag = '';
                if (m.image_path) {
                    imgTag = `
                        <div class="asset-btn-wrap">
                            <img src="/${m.image_path}" class="thumb-img" onclick="event.stopPropagation(); showImgPreview('/${m.image_path}')" title="点击放大预览">
                            <button type="button" class="asset-del-btn" onclick="event.stopPropagation(); deleteMasterAsset('${escapeHtml(m.material_no)}', 'image')" title="移除图片">&times;</button>
                        </div>`;
                } else {
                    imgTag = `<span class="thumb-placeholder" onclick="event.stopPropagation(); triggerImgUpload('${escapeHtml(m.material_no)}')" title="点击上传实物图片">上传图片</span>`;
                }

                // Manual cell
                let manTag = '';
                if (m.manual_path) {
                    const safeName = (m.name || '').replace(/'/g, "\\'");
                    manTag = `
                        <div class="asset-btn-wrap">
                            <button type="button" class="manual-link" style="border: 1px solid #bae6fd; cursor: pointer; background: #f0f9ff; padding: 2px 7px;" onclick="event.stopPropagation(); previewManualOnline('/${m.manual_path}', '${escapeHtml(m.material_no)}', '${safeName}')" title="在线查阅 PDF 手册">查看手册</button>
                            <button type="button" class="asset-del-btn" onclick="event.stopPropagation(); deleteMasterAsset('${escapeHtml(m.material_no)}', 'manual')" title="移除手册">&times;</button>
                        </div>`;
                } else {
                    manTag = `<span class="manual-empty" onclick="event.stopPropagation(); triggerManualUpload('${escapeHtml(m.material_no)}')" title="点击上传技术手册">上传手册</span>`;
                }

                // Child count badge
                let childBadge = '';
                if (m.child_count > 0) {
                    childBadge = `<span class="badge-child-tag" onclick="event.stopPropagation(); openMasterHierarchyModal('${escapeHtml(m.material_no)}')" title="包含 ${m.child_count} 项子零部件，点击管理结构">${m.child_count}项结构</span>`;
                }

                // Referenced projects cell
                const projList = m.referenced_projects || [];
                let projCellHtml = '';
                if (projList && projList.length > 0) {
                    const projBadges = projList.slice(0, 2).map(p => {
                        const pTitle = p.name || p.code || '未命名项目';
                        return `<span class="badge-project-ref" onclick="event.stopPropagation(); openMasterUsageModal('${escapeHtml(m.material_no)}')" title="点击查看项目 [${escapeHtml(pTitle)}] 详细引用位置与Sheet">${escapeHtml(pTitle)}</span>`;
                    }).join('');

                    let moreBadge = '';
                    if (projList.length > 2) {
                        moreBadge = `<span class="badge-project-ref badge-project-more" onclick="event.stopPropagation(); openMasterUsageModal('${escapeHtml(m.material_no)}')" title="共 ${projList.length} 个项目引用，点击查看全部">+${projList.length - 2}</span>`;
                    }
                    const allProjNames = projList.map(p => p.name || p.code).join(', ');
                    projCellHtml = `<div style="display: flex; gap: 4px; align-items: center; overflow: hidden; flex-wrap: nowrap;" title="引用项目 (${projList.length}个): ${escapeHtml(allProjNames)}&#10;点击查看具体Sheet和行号">${projBadges}${moreBadge}</div>`;
                } else {
                    projCellHtml = `<span style="color: #94a3b8; font-size: 12px;">未引用</span>`;
                }

                tr.innerHTML = `
                    ${selectCellHtml}
                    <td>${formatPipeMultilineMatNo(m.material_no, childBadge)}</td>
                    <td>${formatPipeMultilineHtml(m.name || '')}</td>
                    <td>${projCellHtml}</td>
                    <td>${formatPipeMultilineHtml(m.description || '')}</td>
                    <td>${formatPipeMultilineHtml(m.spec_model || '')}</td>
                    <td>${formatPipeMultilineHtml(m.manufacturer || '')}</td>
                    <td class="col-center">${formatPipeMultilineHtml(m.unit || 'PC', true)}</td>
                    <td>${formatPipeMultilineHtml(m.drawing_no || '/')}</td>
                    <td class="col-center">${imgTag}</td>
                    <td class="col-center">${manTag}</td>
                `;
                tbody.appendChild(tr);
            });

            applyColumnWidths('masterTable');
            updateMasterToolbarState();
        }

        // --- Row Click & Selection Helpers ---
        function handleMasterRowClick(event, matNo) {
            if (['INPUT', 'BUTTON', 'IMG', 'A'].includes(event.target.tagName) ||
                event.target.closest('.asset-btn-wrap') ||
                event.target.closest('.badge-child-tag') ||
                event.target.closest('.badge-project-ref') ||
                event.target.closest('.thumb-placeholder') ||
                event.target.closest('.manual-empty')) {
                return;
            }
            toggleMasterRowSelect(matNo);
        }

        function toggleMasterSelectAll(checked) {
            if (checked) {
                (allMasterMaterials || []).forEach(m => selectedMasterMatNos.add(m.material_no));
            } else {
                selectedMasterMatNos.clear();
            }
            renderMasterMaterialsTable();
        }

        function toggleMasterRowSelect(matNo, explicitChecked) {
            if (explicitChecked !== undefined) {
                if (explicitChecked) selectedMasterMatNos.add(matNo);
                else selectedMasterMatNos.delete(matNo);
            } else {
                if (selectedMasterMatNos.has(matNo)) selectedMasterMatNos.delete(matNo);
                else selectedMasterMatNos.add(matNo);
            }
            renderMasterMaterialsTable();
        }

        function clearMasterSelection() {
            selectedMasterMatNos.clear();
            renderMasterMaterialsTable();
        }

        function updateMasterToolbarState() {
            const count = selectedMasterMatNos.size;
            const countSpan = document.getElementById('masterSelectedNum');
            if (countSpan) countSpan.textContent = count;

            const clearBtn = document.getElementById('btnMasterClearSelection');
            if (clearBtn) clearBtn.style.display = count > 0 ? 'inline-block' : 'none';

            const selectAllCb = document.getElementById('masterSelectAll');
            if (selectAllCb) {
                const total = (allMasterMaterials || []).length;
                if (total === 0) {
                    selectAllCb.checked = false;
                    selectAllCb.indeterminate = false;
                } else if (count >= total) {
                    selectAllCb.checked = true;
                    selectAllCb.indeterminate = false;
                } else if (count > 0) {
                    selectAllCb.checked = false;
                    selectAllCb.indeterminate = true;
                } else {
                    selectAllCb.checked = false;
                    selectAllCb.indeterminate = false;
                }
            }
        }

        // --- Column Header Sorting ---
        function handleMasterTableSort(field) {
            if (!allMasterMaterials || allMasterMaterials.length === 0) return;

            if (masterCurrentSortField === field) {
                if (masterCurrentSortDir === 'asc') masterCurrentSortDir = 'desc';
                else if (masterCurrentSortDir === 'desc') masterCurrentSortDir = 'none';
                else masterCurrentSortDir = 'asc';
            } else {
                masterCurrentSortField = field;
                masterCurrentSortDir = 'asc';
            }

            applyMasterSort();
        }

        function applyMasterSort() {
            document.querySelectorAll('.sort-icon[id^="master-sort-"]').forEach(icon => {
                icon.textContent = '⇅';
                icon.classList.remove('active');
            });

            const statusSpan = document.getElementById('masterSortStatusSpan');
            const resetBtn = document.getElementById('btnMasterResetSort');

            if (masterCurrentSortDir === 'none' || !masterCurrentSortField) {
                masterCurrentSortField = null;
                masterCurrentSortDir = 'none';
                if (statusSpan) statusSpan.textContent = '';
                if (resetBtn) resetBtn.style.display = 'none';
                allMasterMaterials = [...rawMasterMaterialsOrder];
            } else {
                const icon = document.getElementById(`master-sort-${masterCurrentSortField}`);
                if (icon) {
                    icon.textContent = masterCurrentSortDir === 'asc' ? '▲' : '▼';
                    icon.classList.add('active');
                }
                const label = MASTER_SORT_FIELD_LABELS[masterCurrentSortField] || masterCurrentSortField;
                if (statusSpan) {
                    statusSpan.textContent = `[按 ${label} ${masterCurrentSortDir === 'asc' ? '升序 ▲' : '降序 ▼'}]`;
                }
                if (resetBtn) resetBtn.style.display = 'inline-flex';

                applyMasterSortList();
            }

            renderMasterMaterialsTable();
        }

        function applyMasterSortList() {
            if (!masterCurrentSortField || masterCurrentSortDir === 'none') return;

            allMasterMaterials.sort((a, b) => {
                let valA, valB;
                if (masterCurrentSortField === 'referenced_projects') {
                    valA = (a.referenced_projects || []).length;
                    valB = (b.referenced_projects || []).length;
                    return masterCurrentSortDir === 'asc' ? (valA - valB) : (valB - valA);
                } else if (masterCurrentSortField === 'image_path') {
                    valA = a.image_path ? 1 : 0;
                    valB = b.image_path ? 1 : 0;
                    return masterCurrentSortDir === 'asc' ? (valB - valA) : (valA - valB);
                } else if (masterCurrentSortField === 'manual_path') {
                    valA = a.manual_path ? 1 : 0;
                    valB = b.manual_path ? 1 : 0;
                    return masterCurrentSortDir === 'asc' ? (valB - valA) : (valA - valB);
                } else {
                    valA = a[masterCurrentSortField] ?? '';
                    valB = b[masterCurrentSortField] ?? '';
                    const numA = parseFloat(valA);
                    const numB = parseFloat(valB);
                    let res = 0;
                    if (!isNaN(numA) && !isNaN(numB) && String(valA).trim() !== '' && String(valB).trim() !== '') {
                        res = numA - numB;
                    } else {
                        res = String(valA).localeCompare(String(valB), 'zh-CN', { numeric: true, sensitivity: 'base' });
                    }
                    return masterCurrentSortDir === 'asc' ? res : -res;
                }
            });
        }

        function resetMasterSort() {
            masterCurrentSortField = null;
            masterCurrentSortDir = 'none';
            applyMasterSort();
            showToast('已恢复物料主库默认排序', 'info');
        }

        // --- Master Toolbar Action Handlers ---
        function handleMasterToolbarEdit() {
            if (selectedMasterMatNos.size === 0) {
                showToast('请先勾选需要编辑的物料行（或直接双击该行）！', 'warning');
                return;
            }
            if (selectedMasterMatNos.size > 1) {
                showToast('每次仅支持编辑单项物料，请只选择 1 项（或直接双击某行）！', 'warning');
                return;
            }
            const matNo = Array.from(selectedMasterMatNos)[0];
            openEditMasterModal(matNo);
        }

        function handleMasterToolbarHierarchy() {
            if (selectedMasterMatNos.size === 0) {
                showToast('请先勾选需要管理装配结构的物料！', 'warning');
                return;
            }
            if (selectedMasterMatNos.size > 1) {
                showToast('总成结构管理仅支持单项物料，请只选择 1 项！', 'warning');
                return;
            }
            const matNo = Array.from(selectedMasterMatNos)[0];
            openMasterHierarchyModal(matNo);
        }

        function handleMasterToolbarUsage() {
            if (selectedMasterMatNos.size === 0) {
                showToast('请先勾选需要追溯引用的物料！', 'warning');
                return;
            }
            if (selectedMasterMatNos.size > 1) {
                showToast('引用追溯仅支持单项物料，请只选择 1 项！', 'warning');
                return;
            }
            const matNo = Array.from(selectedMasterMatNos)[0];
            openMasterUsageModal(matNo);
        }

        async function handleMasterToolbarInsertBom() {
            if (!currentSubsystemId) {
                alert('请先在主界面打开一个机型的子系统 (Sheet)，然后再点击引用物料！');
                return;
            }
            if (selectedMasterMatNos.size === 0) {
                showToast('请先勾选需要引用至当前 BOM 的物料！', 'warning');
                return;
            }

            const selectedNos = Array.from(selectedMasterMatNos);
            if (selectedNos.length === 1) {
                insertMasterToCurrentBom(selectedNos[0]);
                return;
            }

            if (!confirm(`确定将选中的 ${selectedNos.length} 项物料批量导入到当前 Sheet 吗？\n\n（提示：对于总成物料，批量导入将导入总成单行；若需连带导入完整总成树状结构，建议单独引用该总成）`)) {
                return;
            }

            let successCount = 0;
            for (const matNo of selectedNos) {
                const mat = (allMasterMaterials || []).find(m => m.material_no === matNo);
                const payload = {
                    subsystem_id: currentSubsystemId,
                    material_no: matNo,
                    name: mat ? (mat.name || '') : '',
                    m_name: mat ? (mat.name || '') : '',
                    description: mat ? (mat.description || '') : '',
                    m_desc: mat ? (mat.description || '') : '',
                    spec_model: mat ? (mat.spec_model || '') : '',
                    m_model: mat ? (mat.spec_model || '') : '',
                    manufacturer: mat ? (mat.manufacturer || '') : '',
                    m_mfr: mat ? (mat.manufacturer || '') : '',
                    qty: 1,
                    unit: mat ? (mat.unit || 'PC') : 'PC',
                    drawing_no: mat ? (mat.drawing_no || '/') : '/',
                    level_str: '●',
                    level_num: 1,
                    notes: mat ? (mat.notes || '') : '',
                    substitute: mat ? (mat.substitute || '') : '',
                    import_children: false
                };

                try {
                    const res = await safeFetchJson('/api/bom/add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (res && res.success) {
                        successCount++;
                    }
                } catch (e) {
                    console.error('Batch insert error for', matNo, e);
                }
            }

            if (currentSubsystemId) {
                loadBomItems(currentSubsystemId);
            }
            loadMasterMaterials();
            loadMasterStats();
            showToast(`已成功将 ${successCount} 项物料批量导入到当前 Sheet！`, 'success');
        }

        function handleMasterToolbarDelete() {
            if (selectedMasterMatNos.size === 0) {
                showToast('请先勾选需要从物料主库中删除的物料！', 'warning');
                return;
            }

            const selectedNos = Array.from(selectedMasterMatNos);
            deleteMasterMaterialsWithConfirm(selectedNos);
        }

        function openMasterModal() {
            selectedMasterMatNos.clear();
            masterCurrentSortField = null;
            masterCurrentSortDir = 'none';
            const sInput = document.getElementById('masterSearch');
            if (sInput) sInput.value = '';
            const fSelect = document.getElementById('masterFilterType');
            if (fSelect) fSelect.value = 'all';

            toggleMasterStats(false);
            loadMasterStats();
            loadMasterMaterials();
            openModal('masterModal');
            setTimeout(() => {
                initTableColumnResizing('masterTable');
                applyColumnWidths('masterTable');
            }, 60);
        }

        // --- Master Material Attachments State ---
        let mmPendingImgFile = null;
        let mmPendingManualFile = null;
        let mmCurrentImgPath = '';
        let mmCurrentManualPath = '';
        let mmRemoveImageFlag = false;
        let mmRemoveManualFlag = false;

        function triggerMmImgPicker() {
            const input = document.getElementById('mmImgFileInput');
            if (input) input.click();
        }

        function handleMmImgSelected(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            if (window.Step3dViewer && window.Step3dViewer.is3dFile(file)) {
                window.Step3dViewer.open(file, {
                    onConfirm: (snapshotFile) => {
                        handleMm3dSnapshotReady(snapshotFile, file.name);
                    }
                });
                event.target.value = '';
                return;
            }

            if (!file.type.startsWith('image/')) {
                alert('请选择有效的图片文件（PNG / JPG / WEBP）或 3D CAD 模型（.step / .stp）！');
                return;
            }
            mmRemoveImageFlag = false;
            mmPendingImgFile = file;

            const reader = new FileReader();
            reader.onload = function(e) {
                setMmImgPreview(e.target.result, false);
                const status = document.getElementById('mm-img-status');
                if (status) {
                    status.innerHTML = `<span style="color: #16a34a; font-weight: 500;">✓ 已选择本地照片：${escapeHtml(file.name)}</span>（保存后生效）`;
                }
                const badge = document.getElementById('mm-pending-upload-badge');
                if (badge) badge.style.display = 'inline';
                const removeBtn = document.getElementById('mm-remove-img-btn');
                if (removeBtn) removeBtn.style.display = 'inline-block';
            };
            reader.readAsDataURL(file);
        }

        function handleMm3dSnapshotReady(snapshotFile, originalName) {
            mmRemoveImageFlag = false;
            mmPendingImgFile = snapshotFile;
            const reader = new FileReader();
            reader.onload = function(e) {
                setMmImgPreview(e.target.result, false);
                const status = document.getElementById('mm-img-status');
                if (status) {
                    status.innerHTML = `<span style="color: #16a34a; font-weight: 500;">✓ 已从 3D 模型生成实物图：${escapeHtml(originalName || snapshotFile.name)}</span>（保存后生效）`;
                }
                const badge = document.getElementById('mm-pending-upload-badge');
                if (badge) {
                    badge.textContent = '已生成3D截图';
                    badge.style.display = 'inline';
                }
                const removeBtn = document.getElementById('mm-remove-img-btn');
                if (removeBtn) removeBtn.style.display = 'inline-block';
            };
            reader.readAsDataURL(snapshotFile);
        }
        window.handleMm3dSnapshotReady = handleMm3dSnapshotReady;

        async function pasteMmImgFromClipboard() {
            if (!navigator.clipboard || !navigator.clipboard.read) {
                alert('当前浏览器环境不支持一键读取剪贴板，请直接在物料弹窗中按下 Ctrl+V 粘贴！');
                return;
            }
            try {
                const items = await navigator.clipboard.read();
                let foundImage = false;
                for (const item of items) {
                    for (const type of item.types) {
                        if (type.startsWith('image/')) {
                            const blob = await item.getType(type);
                            const file = new File([blob], `pasted_material_${Date.now()}.png`, { type: blob.type });
                            mmRemoveImageFlag = false;
                            mmPendingImgFile = file;
                            const reader = new FileReader();
                            reader.onload = function(e) {
                                setMmImgPreview(e.target.result, false);
                                const status = document.getElementById('mm-img-status');
                                if (status) {
                                    status.innerHTML = `<span style="color: #16a34a; font-weight: 500;">✓ 已从剪贴板成功粘贴实物截图</span>（保存后生效）`;
                                }
                                const badge = document.getElementById('mm-pending-upload-badge');
                                if (badge) badge.style.display = 'inline';
                                const removeBtn = document.getElementById('mm-remove-img-btn');
                                if (removeBtn) removeBtn.style.display = 'inline-block';
                            };
                            reader.readAsDataURL(blob);
                            foundImage = true;
                            break;
                        }
                    }
                    if (foundImage) break;
                }
                if (!foundImage) {
                    alert('剪贴板中未检测到图片数据。请先截图或复制图片后重试！');
                }
            } catch (err) {
                console.warn('Clipboard read error:', err);
                alert('读取剪贴板失败，请直接在弹窗中按下键盘快捷键 Ctrl+V 粘贴！');
            }
        }

        function removeMmImg() {
            mmRemoveImageFlag = true;
            mmPendingImgFile = null;
            mmCurrentImgPath = '';
            const fileInput = document.getElementById('mmImgFileInput');
            if (fileInput) fileInput.value = '';
            resetMmImgPreview();
            const status = document.getElementById('mm-img-status');
            if (status) {
                status.innerHTML = '<span style="color: #dc2626;">已标记移除照片（保存后生效）</span>';
            }
        }

        function enlargeMmImage() {
            const preview = document.getElementById('mm-img-preview');
            if (preview && preview.src && preview.style.display !== 'none') {
                if (typeof showImgPreview === 'function') {
                    showImgPreview(preview.src);
                } else {
                    window.open(preview.src, '_blank');
                }
            } else {
                triggerMmImgPicker();
            }
        }

        function setMmImgPreview(src, isExisting) {
            const preview = document.getElementById('mm-img-preview');
            const placeholder = document.getElementById('mm-img-placeholder');
            const tag = document.getElementById('mm-img-tag');
            const removeBtn = document.getElementById('mm-remove-img-btn');
            const zoomHint = document.getElementById('mm-img-zoom-hint');

            if (preview) {
                preview.src = src;
                preview.style.display = 'block';
            }
            if (placeholder) placeholder.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'inline-block';
            if (zoomHint) zoomHint.style.display = 'block';

            if (isExisting) {
                if (tag) tag.style.display = 'inline';
                const status = document.getElementById('mm-img-status');
                if (status) {
                    status.innerHTML = '已有关联照片，可点击预览、上传替换或移除。';
                }
                const badge = document.getElementById('mm-pending-upload-badge');
                if (badge) badge.style.display = 'none';
            }
        }

        function resetMmImgPreview() {
            const preview = document.getElementById('mm-img-preview');
            const placeholder = document.getElementById('mm-img-placeholder');
            const tag = document.getElementById('mm-img-tag');
            const removeBtn = document.getElementById('mm-remove-img-btn');
            const zoomHint = document.getElementById('mm-img-zoom-hint');
            const badge = document.getElementById('mm-pending-upload-badge');

            if (preview) {
                preview.src = '';
                preview.style.display = 'none';
            }
            if (placeholder) placeholder.style.display = 'block';
            if (tag) tag.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'none';
            if (zoomHint) zoomHint.style.display = 'none';
            if (badge) badge.style.display = 'none';

            const status = document.getElementById('mm-img-status');
            if (status) {
                status.innerHTML = '支持本地选择、<b>快捷键 Ctrl+V 粘贴截图</b>或拖拽图片（PNG / JPG / WEBP）。';
            }
        }

        // --- Master Material Technical Manual (PDF) Handlers ---
        function triggerMmManualPicker() {
            const input = document.getElementById('mmManualFileInput');
            if (input) input.click();
        }

        function handleMmManualSelected(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
                alert('仅支持上传 PDF 格式的技术手册！');
                return;
            }
            mmRemoveManualFlag = false;
            mmPendingManualFile = file;
            setMmManualPreview(file.name, false);

            const status = document.getElementById('mm-manual-status');
            if (status) {
                status.innerHTML = `<span style="color: #16a34a; font-weight: 500;">✓ 已选择本地手册：${escapeHtml(file.name)}</span>（保存后生效）`;
            }
            const badge = document.getElementById('mm-pending-manual-badge');
            if (badge) badge.style.display = 'inline';
            const removeBtn = document.getElementById('mm-remove-manual-btn');
            if (removeBtn) removeBtn.style.display = 'inline-block';
            const previewBtn = document.getElementById('mm-preview-manual-btn');
            if (previewBtn) previewBtn.style.display = 'inline-block';
        }

        function handleMmManualClick() {
            if (mmPendingManualFile || mmCurrentManualPath) {
                previewMmManual();
            } else {
                triggerMmManualPicker();
            }
        }

        function previewMmManual() {
            const matNo = (document.getElementById('mm-mat-no').value || '').trim();
            const matName = (document.getElementById('mm-name').value || '').trim();

            if (mmPendingManualFile) {
                const blobUrl = URL.createObjectURL(mmPendingManualFile);
                if (typeof previewManualOnline === 'function') {
                    previewManualOnline(blobUrl, matNo, matName);
                } else {
                    window.open(blobUrl, '_blank');
                }
                return;
            }

            if (mmCurrentManualPath) {
                const fullUrl = mmCurrentManualPath.startsWith('/') ? mmCurrentManualPath : '/' + mmCurrentManualPath;
                if (typeof previewManualOnline === 'function') {
                    previewManualOnline(fullUrl, matNo, matName);
                } else {
                    window.open(fullUrl, '_blank');
                }
            } else {
                triggerMmManualPicker();
            }
        }

        function removeMmManual() {
            mmRemoveManualFlag = true;
            mmPendingManualFile = null;
            mmCurrentManualPath = '';
            const input = document.getElementById('mmManualFileInput');
            if (input) input.value = '';
            resetMmManualPreview();
            const status = document.getElementById('mm-manual-status');
            if (status) {
                status.innerHTML = '<span style="color: #dc2626;">已标记移除技术手册（保存后生效）</span>';
            }
        }

        function setMmManualPreview(pathOrName, isExisting) {
            const icon = document.getElementById('mm-manual-icon');
            const fname = document.getElementById('mm-manual-filename');
            const placeholder = document.getElementById('mm-manual-placeholder');
            const tag = document.getElementById('mm-manual-tag');
            const removeBtn = document.getElementById('mm-remove-manual-btn');
            const previewBtn = document.getElementById('mm-preview-manual-btn');
            const zoomHint = document.getElementById('mm-manual-zoom-hint');

            const displayName = pathOrName.split('/').pop().split('\\').pop();

            if (icon) icon.style.display = 'block';
            if (fname) {
                fname.textContent = displayName;
                fname.style.display = 'block';
            }
            if (placeholder) placeholder.style.display = 'none';
            if (removeBtn) removeBtn.style.display = 'inline-block';
            if (previewBtn) previewBtn.style.display = 'inline-block';
            if (zoomHint) zoomHint.style.display = 'block';

            if (isExisting) {
                if (tag) tag.style.display = 'inline';
                const status = document.getElementById('mm-manual-status');
                if (status) {
                    status.innerHTML = '已有关联 PDF 技术手册，可点击在线查阅或替换。';
                }
                const badge = document.getElementById('mm-pending-manual-badge');
                if (badge) badge.style.display = 'none';
            }
        }

        function resetMmManualPreview() {
            const icon = document.getElementById('mm-manual-icon');
            const fname = document.getElementById('mm-manual-filename');
            const placeholder = document.getElementById('mm-manual-placeholder');
            const tag = document.getElementById('mm-manual-tag');
            const removeBtn = document.getElementById('mm-remove-manual-btn');
            const previewBtn = document.getElementById('mm-preview-manual-btn');
            const zoomHint = document.getElementById('mm-manual-zoom-hint');
            const badge = document.getElementById('mm-pending-manual-badge');

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
            if (badge) badge.style.display = 'none';

            const status = document.getElementById('mm-manual-status');
            if (status) {
                status.innerHTML = '支持关联标准 PDF 格式技术手册，可在线查阅。';
            }
        }

        function initMmAttachmentListeners() {
            const imgContainer = document.getElementById('mm-img-container');
            const imgCard = document.getElementById('mm-img-card');
            const manualContainer = document.getElementById('mm-manual-container');
            const manualCard = document.getElementById('mm-manual-card');
            const modal = document.getElementById('editMasterItemModal');

            // Image Drag & Drop
            [imgContainer, imgCard].filter(Boolean).forEach(el => {
                el.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (imgContainer) imgContainer.style.borderColor = '#2563eb';
                });
                el.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (imgContainer) imgContainer.style.borderColor = '#cbd5e1';
                });
                el.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (imgContainer) imgContainer.style.borderColor = '#cbd5e1';
                    const dt = e.dataTransfer;
                    if (dt && dt.files && dt.files.length > 0) {
                        const file = dt.files[0];
                        if (file.type.startsWith('image/') || (window.Step3dViewer && window.Step3dViewer.is3dFile(file))) {
                            handleMmImgSelected({ target: { files: [file] } });
                        } else {
                            alert('拖入的文件不是图片或 3D CAD 模型格式，请拖拽 PNG / JPG / WEBP 或 .step / .stp 文件！');
                        }
                    }
                });
            });

            // Manual Drag & Drop
            [manualContainer, manualCard].filter(Boolean).forEach(el => {
                el.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (manualContainer) manualContainer.style.borderColor = '#ef4444';
                });
                el.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (manualContainer) manualContainer.style.borderColor = '#cbd5e1';
                });
                el.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (manualContainer) manualContainer.style.borderColor = '#cbd5e1';
                    const dt = e.dataTransfer;
                    if (dt && dt.files && dt.files.length > 0) {
                        const file = dt.files[0];
                        if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
                            handleMmManualSelected({ target: { files: [file] } });
                        } else {
                            alert('拖入的文件不是 PDF 格式技术手册，请拖入 PDF 文件！');
                        }
                    }
                });
            });

            // Paste listener inside editMasterItemModal
            if (modal) {
                modal.addEventListener('paste', (e) => {
                    const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
                    const items = e.clipboardData && e.clipboardData.items;
                    if (!items) return;

                    let imgItem = null;
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].type.indexOf('image') !== -1) {
                            imgItem = items[i];
                            break;
                        }
                    }

                    if (imgItem) {
                        if (!isInput || !e.clipboardData.getData('text')) {
                            e.preventDefault();
                            const blob = imgItem.getAsFile();
                            if (blob) {
                                handleMmImgSelected({ target: { files: [blob] } });
                            }
                        }
                    }
                });
            }

            // Real-time duplicate check when typing in mm-name or mm-spec-model
            const mmNameInput = document.getElementById('mm-name');
            const mmSpecInput = document.getElementById('mm-spec-model');
            if (mmNameInput) {
                mmNameInput.addEventListener('input', () => {
                    if (typeof checkInputMaterialDuplicate === 'function') checkInputMaterialDuplicate();
                });
            }
            if (mmSpecInput) {
                mmSpecInput.addEventListener('input', () => {
                    if (typeof checkInputMaterialDuplicate === 'function') checkInputMaterialDuplicate();
                });
            }
        }

        // --- Create / Edit Material Modal ---
        function openCreateMasterModal() {
            populateMasterDatalists();
            document.getElementById('editMasterModalTitle').textContent = '新建物料';
            document.getElementById('mm-is-create').value = 'true';
            document.getElementById('mm-old-mat-no').value = '';
            
            const matNoInput = document.getElementById('mm-mat-no');
            matNoInput.value = '';
            matNoInput.disabled = false;
            matNoInput.style.backgroundColor = '#ffffff';

            document.getElementById('mm-name').value = '';
            document.getElementById('mm-spec-model').value = '';
            document.getElementById('mm-manufacturer').value = '';
            document.getElementById('mm-unit').value = 'PC';
            document.getElementById('mm-drawing-no').value = '/';
            document.getElementById('mm-substitute').value = '';
            document.getElementById('mm-description').value = '';
            document.getElementById('mm-notes').value = '';

            // Reset attachments
            mmPendingImgFile = null;
            mmPendingManualFile = null;
            mmCurrentImgPath = '';
            mmCurrentManualPath = '';
            mmRemoveImageFlag = false;
            mmRemoveManualFlag = false;
            const imgInput = document.getElementById('mmImgFileInput');
            if (imgInput) imgInput.value = '';
            const manualInput = document.getElementById('mmManualFileInput');
            if (manualInput) manualInput.value = '';
            resetMmImgPreview();
            resetMmManualPreview();

            const warnBox = document.getElementById('mat-dup-warning-box');
            if (warnBox) warnBox.style.display = 'none';

            document.getElementById('mm-sync-group').style.display = 'none';

            openModal('editMasterItemModal');
            setTimeout(() => matNoInput.focus(), 100);
        }

        function openEditMasterModal(matNo) {
            const mat = (allMasterMaterials || []).find(m => m.material_no === matNo);
            if (!mat) {
                fetch(`/api/materials?q=${encodeURIComponent(matNo)}`)
                    .then(r => r.json())
                    .then(list => {
                        const found = list.find(x => x.material_no === matNo) || list[0];
                        if (found) populateEditMasterModal(found);
                    });
                return;
            }
            populateEditMasterModal(mat);
        }

        function populateEditMasterModal(mat) {
            populateMasterDatalists();
            document.getElementById('editMasterModalTitle').textContent = `编辑物料 [${mat.material_no}]`;
            document.getElementById('mm-is-create').value = 'false';
            document.getElementById('mm-old-mat-no').value = mat.material_no;

            const matNoInput = document.getElementById('mm-mat-no');
            matNoInput.value = mat.material_no;
            matNoInput.disabled = false;
            matNoInput.style.backgroundColor = '#ffffff';

            document.getElementById('mm-name').value = mat.name || '';
            document.getElementById('mm-spec-model').value = mat.spec_model || '';
            document.getElementById('mm-manufacturer').value = mat.manufacturer || '';
            document.getElementById('mm-unit').value = mat.unit || 'PC';
            document.getElementById('mm-drawing-no').value = mat.drawing_no || '/';
            document.getElementById('mm-substitute').value = mat.substitute || '';
            document.getElementById('mm-description').value = mat.description || '';
            document.getElementById('mm-notes').value = mat.notes || '';

            // Attachments state
            mmPendingImgFile = null;
            mmPendingManualFile = null;
            mmRemoveImageFlag = false;
            mmRemoveManualFlag = false;
            const imgInput = document.getElementById('mmImgFileInput');
            if (imgInput) imgInput.value = '';
            const manualInput = document.getElementById('mmManualFileInput');
            if (manualInput) manualInput.value = '';

            mmCurrentImgPath = mat.image_path || '';
            if (mmCurrentImgPath) {
                const fullImgUrl = mmCurrentImgPath.startsWith('/') ? mmCurrentImgPath : '/' + mmCurrentImgPath;
                setMmImgPreview(fullImgUrl, true);
            } else {
                resetMmImgPreview();
            }

            mmCurrentManualPath = mat.manual_path || '';
            if (mmCurrentManualPath) {
                setMmManualPreview(mmCurrentManualPath, true);
            } else {
                resetMmManualPreview();
            }

            const warnBox = document.getElementById('mat-dup-warning-box');
            if (warnBox) warnBox.style.display = 'none';

            const syncGroup = document.getElementById('mm-sync-group');
            syncGroup.style.display = 'block';
            document.getElementById('mm-sync-bom').checked = true;

            openModal('editMasterItemModal');
            setTimeout(() => document.getElementById('mm-name').focus(), 100);
        }

        async function submitMasterItem() {
            const isCreate = document.getElementById('mm-is-create').value === 'true';
            const oldMatNo = document.getElementById('mm-old-mat-no').value.trim();
            const matNo = document.getElementById('mm-mat-no').value.trim();
            const name = document.getElementById('mm-name').value.trim();
            const desc = document.getElementById('mm-description').value.trim();

            if (!matNo) {
                alert('请输入物料号！');
                document.getElementById('mm-mat-no').focus();
                return;
            }
            if (!name) {
                alert('请输入元器件名称！');
                document.getElementById('mm-name').focus();
                return;
            }
            if (!desc) {
                alert('请输入物料完整描述！');
                document.getElementById('mm-description').focus();
                return;
            }

            // Upload pending image if any
            if (mmPendingImgFile) {
                const fd = new FormData();
                fd.append('file', mmPendingImgFile);
                fd.append('material_no', matNo);
                try {
                    await fetch('/api/upload/image', { method: 'POST', body: fd });
                } catch (e) {
                    console.error('Master item image upload failed:', e);
                }
            }

            // Upload pending manual if any
            if (mmPendingManualFile) {
                const fdManual = new FormData();
                fdManual.append('file', mmPendingManualFile);
                fdManual.append('material_no', matNo);
                try {
                    await fetch('/api/upload/manual', { method: 'POST', body: fdManual });
                } catch (e) {
                    console.error('Master item manual upload failed:', e);
                }
            }

            const payload = {
                is_create: isCreate,
                old_material_no: oldMatNo,
                material_no: matNo,
                name: name,
                description: desc,
                spec_model: document.getElementById('mm-spec-model').value.trim(),
                manufacturer: document.getElementById('mm-manufacturer').value.trim(),
                unit: document.getElementById('mm-unit').value.trim() || 'PC',
                drawing_no: document.getElementById('mm-drawing-no').value.trim() || '/',
                substitute: document.getElementById('mm-substitute').value.trim(),
                notes: document.getElementById('mm-notes').value.trim(),
                sync_bom: document.getElementById('mm-sync-bom').checked,
                remove_image: mmRemoveImageFlag,
                remove_manual: mmRemoveManualFlag
            };

            fetch('/api/material/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    mmPendingImgFile = null;
                    mmPendingManualFile = null;
                    mmRemoveImageFlag = false;
                    mmRemoveManualFlag = false;

                    closeModal('editMasterItemModal');
                    loadMasterMaterials();
                    loadMasterStats();
                    if (currentSubsystemId) {
                        loadBomItems(currentSubsystemId);
                    }
                    if (isCreate) {
                        showToast(`物料 [${matNo}] 已新建入库。`, 'success');
                    } else if (res.synced_rows_count > 0) {
                        showToast(`物料 [${matNo}] 更新成功，并已同步更新 ${res.synced_rows_count} 个引用 BOM 行。`, 'success');
                    } else {
                        showToast(`物料 [${matNo}] 信息已保存。`, 'success');
                    }
                } else {
                    alert(res.error || '保存物料失败');
                }
            })
            .catch(err => alert('网络异常: ' + err.message));
        }

        // --- Delete Material with Friendly Confirmation (Single & Batch) ---
        async function deleteMasterMaterialsWithConfirm(matNos) {
            if (!matNos || matNos.length === 0) return;

            if (matNos.length === 1) {
                const matNo = matNos[0];
                const mat = (allMasterMaterials || []).find(m => m.material_no === matNo);
                const refList = mat ? (mat.referenced_projects || []) : [];
                let confirmMsg = '';

                if (refList.length > 0) {
                    const refNames = refList.map(p => p.name || p.code).slice(0, 3).join('、');
                    const moreText = refList.length > 3 ? ` 等共 ${refList.length} 个项目` : '';
                    confirmMsg = `【⚠️ 引用风险警示】\n\n物料 [${matNo}]（${mat ? (mat.name || '') : ''}）当前正被项目 BOM 引用：\n• 引用项目：${refNames}${moreText}\n\n从物料主库中删除后，该物料在全局通用物料库的记录及装配层级关系将被清除！\n\n确定仍要从主库中删除该物料吗？此操作不可撤销。`;
                } else {
                    confirmMsg = `确定要从全局物料主库中删除物料 [${matNo}]（${mat ? (mat.name || '') : ''}）吗？\n\n删除后不可撤销，请确认是否继续。`;
                }

                if (!confirm(confirmMsg)) return;

                try {
                    const res = await safeFetchJson('/api/material/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ material_no: matNo })
                    });
                    if (res && res.success) {
                        selectedMasterMatNos.delete(matNo);
                        showToast(`物料 [${matNo}] 已从物料主库中删除。`, 'success');
                        loadMasterMaterials();
                        loadMasterStats();
                    } else {
                        alert((res && res.error) || '删除失败');
                    }
                } catch (err) {
                    alert('网络异常: ' + err.message);
                }
            } else {
                // Batch deletion confirmation
                const selectedList = (allMasterMaterials || []).filter(m => matNos.includes(m.material_no));
                const referencedItems = selectedList.filter(m => m.referenced_projects && m.referenced_projects.length > 0);

                let confirmMsg = `确定要从全局物料主库中批量删除选中的 ${matNos.length} 项物料吗？\n\n此操作不可撤销。`;
                if (referencedItems.length > 0) {
                    const sampleNames = referencedItems.slice(0, 3).map(m => m.material_no).join('、');
                    const moreText = referencedItems.length > 3 ? ` 等共 ${referencedItems.length} 项` : '';
                    confirmMsg = `【⚠️ 批量删除高危警示】\n\n本次勾选的 ${matNos.length} 项物料中，有 ${referencedItems.length} 项已被工程项目引用（包含：${sampleNames}${moreText}）！\n\n删除后，这些物料在通用主库中的主数据及总成层级结构将被清除！\n\n确认全部批量删除吗？`;
                }

                if (!confirm(confirmMsg)) return;

                try {
                    const res = await safeFetchJson('/api/materials/batch-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ material_nos: matNos })
                    });
                    if (res && res.success) {
                        matNos.forEach(no => selectedMasterMatNos.delete(no));
                        showToast((res && res.message) || `成功批量删除 ${matNos.length} 项物料。`, 'success');
                        loadMasterMaterials();
                        loadMasterStats();
                    } else {
                        alert((res && res.error) || '批量删除失败');
                    }
                } catch (err) {
                    alert('网络异常: ' + err.message);
                }
            }
        }

        function deleteMasterMaterial(matNo) {
            deleteMasterMaterialsWithConfirm([matNo]);
        }


        // --- Delete Asset (Image / Manual) ---
        function deleteMasterAsset(matNo, assetType) {
            const typeLabel = assetType === 'image' ? '实物图片' : '技术手册';
            if (!confirm(`确定要移除物料 [${matNo}] 的${typeLabel}吗？`)) return;

            fetch('/api/material/asset/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ material_no: matNo, asset_type: assetType })
            })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    showToast(`已移除物料 [${matNo}] 的${typeLabel}！`, 'success');
                    loadMasterMaterials();
                    loadMasterStats();
                    if (currentSubsystemId) {
                        loadBomItems(currentSubsystemId);
                    }
                } else {
                    alert(res.error || '移除失败');
                }
            })
            .catch(err => alert('网络异常: ' + err.message));
        }

        // --- Hierarchy Sub-assembly Structure Management ---
        function openMasterHierarchyModal(parentMatNo) {
            document.getElementById('hier-parent-mat').value = parentMatNo;
            document.getElementById('hier-edit-id').value = '';
            document.getElementById('hierarchyModalTitle').innerHTML = `总成 [${parentMatNo}] 装配结构管理`;

            const parentMat = (allMasterMaterials || []).find(m => m.material_no === parentMatNo);
            const parentName = parentMat ? `(${parentMat.name || ''} - ${parentMat.description || ''})` : '';

            // Automatically determine parent level: child is always the next level
            let parentLvl = 1;
            if (currentBomItems && currentBomItems.length > 0) {
                const bomMatch = currentBomItems.find(it => it.material_no === parentMatNo);
                if (bomMatch && bomMatch.level_num) {
                    parentLvl = parseInt(bomMatch.level_num) || 1;
                }
            }
            const nextLvl = parentLvl + 1;
            const nextLvlStr = nextLvl === 2 ? '二级 ●●' : (nextLvl === 3 ? '三级 ●●●' : `${nextLvl}级 ${'●'.repeat(nextLvl)}`);
            const hintEl = document.getElementById('hierNextLvlHint');
            if (hintEl) hintEl.textContent = nextLvlStr;

            document.getElementById('hierarchyModalSubtitle').innerHTML = 
                `维护总成 <b>${parentMatNo}</b> ${escapeHtml(parentName)} 的标准子零部件结构（添加的物料将归为此总成的下一层：<b>${nextLvlStr}</b>）。在 BOM 中引入此总成时可关联导入整套子层级。`;

            resetHierChildForm(nextLvl);
            loadHierarchyChildren(parentMatNo);
            openModal('masterHierarchyModal');
        }

        function resetHierChildForm(defaultLvl) {
            document.getElementById('hier-edit-id').value = '';
            document.getElementById('hier-child-search').value = '';
            if (defaultLvl) {
                document.getElementById('hier-level-num').value = defaultLvl;
            }
            document.getElementById('hier-qty').value = '1';
            document.getElementById('hier-unit').value = 'PC';
            document.getElementById('hier-drawing').value = '/';
            document.getElementById('hierSubmitBtn').innerHTML = '加入结构';
            const drop = document.getElementById('hierFuzzyDropdown');
            if (drop) drop.style.display = 'none';
        }

        function handleHierChildSearch(val) {
            clearTimeout(hierFuzzyDebounceTimer);
            const dropdown = document.getElementById('hierFuzzyDropdown');
            const parentMatNo = document.getElementById('hier-parent-mat').value;
            const q = val.trim().toLowerCase();

            if (!q) {
                dropdown.style.display = 'none';
                return;
            }

            hierFuzzyDebounceTimer = setTimeout(() => {
                const matches = (allMasterMaterials || []).filter(m => {
                    if (m.material_no === parentMatNo) return false;
                    return (m.material_no && m.material_no.toLowerCase().includes(q)) ||
                           (m.name && m.name.toLowerCase().includes(q)) ||
                           (m.description && m.description.toLowerCase().includes(q)) ||
                           (m.spec_model && m.spec_model.toLowerCase().includes(q));
                }).slice(0, 10);

                if (matches.length === 0) {
                    dropdown.style.display = 'none';
                    return;
                }

                dropdown.innerHTML = '';
                matches.forEach(m => {
                    const item = document.createElement('div');
                    item.className = 'fuzzy-item';
                    item.innerHTML = `
                        <div style="font-weight: 600; color: #1e3a8a;">${escapeHtml(m.material_no)} - ${escapeHtml(m.name || '')}</div>
                        <div style="font-size: 11px; color: #64748b; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(m.description || m.spec_model || '')}</div>
                    `;
                    item.onmousedown = (e) => {
                        e.preventDefault();
                        selectHierChildMaterial(m);
                    };
                    dropdown.appendChild(item);
                });
                dropdown.style.display = 'block';
            }, 150);
        }

        function selectHierChildMaterial(m) {
            document.getElementById('hier-child-search').value = m.material_no;
            if (m.unit) document.getElementById('hier-unit').value = m.unit;
            if (m.drawing_no && m.drawing_no !== '/') document.getElementById('hier-drawing').value = m.drawing_no;
            document.getElementById('hierFuzzyDropdown').style.display = 'none';
            document.getElementById('hier-qty').focus();
        }

        function loadHierarchyChildren(parentMatNo) {
            fetch(`/api/material/${encodeURIComponent(parentMatNo)}/structure`)
                .then(r => r.json())
                .then(data => {
                    const tbody = document.getElementById('hierTableBody');
                    tbody.innerHTML = '';
                    const children = data.children || [];
                    document.getElementById('hierChildCount').textContent = children.length;
                    const clearBtn = document.getElementById('btnHierClearAll');
                    if (clearBtn) {
                        clearBtn.disabled = (children.length === 0);
                        clearBtn.style.opacity = (children.length === 0 ? '0.45' : '1');
                        clearBtn.style.pointerEvents = (children.length === 0 ? 'none' : 'auto');
                    }

                    if (children.length === 0) {
                        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 25px;">该总成尚未配置子零部件结构，请在上方添加</td></tr>`;
                        return;
                    }

                    children.forEach((c, idx) => {
                        const tr = document.createElement('tr');
                        const matName = c.name || c.m_name || '';
                        const matDesc = c.description || c.m_desc || '';
                        const matModel = c.spec_model || c.m_model || '';
                        const modelTag = matModel ? `<span style="color:#64748b; margin-left: 4px;">(${escapeHtml(matModel)})</span>` : '';

                        tr.innerHTML = `
                            <td class="col-center">
                                <div class="action-btns">
                                    <button class="btn btn-outline btn-sm" onclick="editHierarchyChildRow(${JSON.stringify(c).replace(/"/g, '&quot;')})" title="编辑此行参数">编辑</button>
                                    <button class="btn btn-outline btn-sm btn-delete" onclick="deleteMasterChild(${c.id}, '${escapeHtml(parentMatNo)}')" title="移出此子件">移除</button>
                                </div>
                            </td>
                            <td class="col-center">
                                <div style="display: flex; gap: 2px; justify-content: center;">
                                    <button class="btn btn-outline btn-sm" style="padding: 1px 4px; font-size: 10px;" onclick="moveMasterChild(${c.id}, 'up', '${escapeHtml(parentMatNo)}')" ${idx === 0 ? 'disabled' : ''} title="上移">▲</button>
                                    <button class="btn btn-outline btn-sm" style="padding: 1px 4px; font-size: 10px;" onclick="moveMasterChild(${c.id}, 'down', '${escapeHtml(parentMatNo)}')" ${idx === children.length - 1 ? 'disabled' : ''} title="下移">▼</button>
                                </div>
                            </td>
                            <td>${formatPipeMultilineMatNo(c.child_material_no)}</td>
                            <td>${formatPipeMultilineHtml(matName)}</td>
                            <td>${formatPipeMultilineHtml(matDesc ? (matModel ? `${matDesc} (${matModel})` : matDesc) : '')}</td>
                            <td class="col-center">${formatPipeMultilineHtml(c.qty, true)}</td>
                            <td class="col-center">${formatPipeMultilineHtml(c.unit || 'PC', true)}</td>
                            <td>${formatPipeMultilineHtml(c.drawing_no || '/')}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                })
                .catch(err => console.error('Error loading hierarchy:', err));
        }

        function editHierarchyChildRow(c) {
            document.getElementById('hier-edit-id').value = c.id;
            document.getElementById('hier-child-search').value = c.child_material_no;
            document.getElementById('hier-level-num').value = c.child_level_num || c.level_num || 2;
            document.getElementById('hier-qty').value = c.qty || 1;
            document.getElementById('hier-unit').value = c.unit || 'PC';
            document.getElementById('hier-drawing').value = c.drawing_no || '/';
            document.getElementById('hierSubmitBtn').innerHTML = '保存更新';
            document.getElementById('hier-qty').focus();
        }

        function submitSaveHierarchyChild() {
            const parentMatNo = document.getElementById('hier-parent-mat').value;
            const childMatNo = document.getElementById('hier-child-search').value.trim();
            const editId = document.getElementById('hier-edit-id').value;

            if (!childMatNo) {
                alert('请输入或选择要挂接的子物料号！');
                document.getElementById('hier-child-search').focus();
                return;
            }

            if (childMatNo.toUpperCase() === parentMatNo.toUpperCase()) {
                alert('不能将总成自身挂接为自己的子零部件！');
                return;
            }

            const payload = {
                id: editId ? parseInt(editId) : null,
                parent_material_no: parentMatNo,
                child_material_no: childMatNo,
                child_level_num: parseInt(document.getElementById('hier-level-num').value) || 2,
                level_num: parseInt(document.getElementById('hier-level-num').value) || 2,
                qty: document.getElementById('hier-qty').value.trim() || '1',
                unit: document.getElementById('hier-unit').value.trim() || 'PC',
                drawing_no: document.getElementById('hier-drawing').value.trim() || '/'
            };

            fetch('/api/material/structure/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    resetHierChildForm();
                    loadHierarchyChildren(parentMatNo);
                    loadMasterMaterials();
                    loadMasterStats();
                    showToast(`子零部件 [${childMatNo}] 结构已更新。`, 'success');
                } else {
                    alert(res.error || '保存结构失败');
                }
            })
            .catch(err => alert('网络异常: ' + err.message));
        }

        function deleteMasterChild(id, parentMatNo) {
            if (!confirm('确定将该子零部件从该总成结构树中移出吗？')) return;

            fetch('/api/material/structure/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    loadHierarchyChildren(parentMatNo);
                    loadMasterMaterials();
                    loadMasterStats();
                    showToast('子零部件已移出。', 'success');
                } else {
                    alert(res.error || '移出失败');
                }
            })
            .catch(err => alert('网络异常: ' + err.message));
        }

        function clearAllMasterChildren() {
            const parentMatNo = document.getElementById('hier-parent-mat').value;
            const count = parseInt(document.getElementById('hierChildCount').textContent) || 0;
            if (!parentMatNo) return;
            if (count === 0) {
                alert('当前下属子零部件清单已为空，无需清空。');
                return;
            }
            if (!confirm(`确定要清空总成【${parentMatNo}】下属的全部 ${count} 个子零部件吗？\n\n清空后：\n1. 该总成的下层标准树状结构将被清空；\n2. 该物料将变更为独立普通单件（物料主库中各子物料本身不受影响）；\n\n此操作不可撤销，确定执行清空吗？`)) {
                return;
            }

            safeFetchJson('/api/material/structure/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_material_no: parentMatNo })
            }).then(res => {
                if (res.success) {
                    showToast(res.message || '已清空下属子零部件。', 'info');
                    resetHierChildForm();
                    loadHierarchyChildren(parentMatNo);
                    loadMasterMaterials();
                    loadMasterStats();
                } else {
                    alert(res.error || '清空失败');
                }
            }).catch(err => {
                alert('清空操作异常: ' + err.message);
            });
        }

        function moveMasterChild(id, direction, parentMatNo) {
            fetch('/api/material/structure/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, direction: direction, parent_material_no: parentMatNo })
            })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    loadHierarchyChildren(parentMatNo);
                } else {
                    alert(res.error || '排序移动失败');
                }
            })
            .catch(err => alert('网络异常: ' + err.message));
        }

        // --- Where-Used Analysis Modal ---
        function openMasterUsageModal(matNo) {
            document.getElementById('usageModalTitle').innerHTML = `物料 [${escapeHtml(matNo)}] 引用明细与溯源`;
            const tbody = document.getElementById('usageTableBody');
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 25px;">正在分析各项目引用关系...</td></tr>`;
            document.getElementById('usageSummaryText').textContent = '';

            openModal('masterUsageModal');

            fetch(`/api/material/${encodeURIComponent(matNo)}/usage`)
                .then(r => r.json())
                .then(data => {
                    const usages = data.usages || data.usage || [];
                    document.getElementById('usageSummaryText').innerHTML = 
                        `物料 <b>${escapeHtml(matNo)}</b> 共在系统内被引用 <b>${usages.length}</b> 次：`;

                    tbody.innerHTML = '';
                    if (usages.length === 0) {
                        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 25px;">该物料暂未被任何项目 BOM 引用</td></tr>`;
                        return;
                    }

                    usages.forEach(u => {
                        const tr = document.createElement('tr');
                        const projTitle = u.project_name || u.project_code || '未命名项目';
                        const codeTag = (u.project_code && u.project_code !== projTitle) ? ` <span style="font-size: 11px; color: #64748b; font-weight: normal;">[${escapeHtml(u.project_code)}]</span>` : '';
                        const lvlStr = u.level_str || (u.level_num ? ('•'.repeat(Math.min(10, Math.max(1, parseInt(u.level_num)))) || u.level_num) : '••');
                        tr.innerHTML = `
                            <td><b>${escapeHtml(projTitle)}</b>${codeTag}</td>
                            <td><span style="color: #2563eb; font-weight: 500;">${escapeHtml(u.subsystem_name || '')}</span></td>
                            <td class="col-center">${u.row_num || '-'}</td>
                            <td class="col-center"><span class="badge-level" style="font-size: 11px;">${escapeHtml(lvlStr)}</span></td>
                            <td class="col-center">${u.qty || 1}</td>
                            <td class="col-center">
                                <button type="button" class="btn btn-outline btn-sm" onclick="jumpToProjectSubsystem(${u.project_id}, ${u.subsystem_id})" title="直接切换并跳转到该项目的此Sheet中">
                                    查看引用
                                </button>
                            </td>
                        `;
                        tbody.appendChild(tr);
                    });
                })
                .catch(err => {
                    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">查询引用失败: ${err.message}</td></tr>`;
                });
        }

        function jumpToProjectSubsystem(projId, subId) {
            closeModal('masterUsageModal');
            closeModal('masterModal');

            if (currentProjectId != projId) {
                const sel = document.getElementById('projectSelect');
                if (sel) sel.value = projId;
                loadProject(projId, subId);
            } else {
                switchSubsystemTab(subId);
            }
            showToast('已跳转至引用该物料的项目子系统 Sheet。', 'info');
        }

        // --- Insert Master Material to Current BOM Sheet ---
        function insertMasterToCurrentBom(matNo) {
            if (!currentSubsystemId) {
                alert('请先在主界面打开一个机型的子系统 (Sheet)，然后再点击引用物料！');
                return;
            }

            const mat = (allMasterMaterials || []).find(m => m.material_no === matNo);
            const childCount = mat ? (mat.child_count || 0) : 0;
            let importChildren = false;

            if (childCount > 0) {
                const confirmMsg = `检测到物料 [${matNo}] 为包含 ${childCount} 个子零部件的标准总成！\n\n是否同时将该总成下属的全部 ${childCount} 个子零部件一并整组导入当前 Sheet？\n\n【确定】导入整套总成及全部子零部件 (推荐)\n【取消】仅导入该总成单行`;
                importChildren = confirm(confirmMsg);
            }

            const payload = {
                subsystem_id: currentSubsystemId,
                material_no: matNo,
                name: mat ? (mat.name || '') : '',
                m_name: mat ? (mat.name || '') : '',
                description: mat ? (mat.description || '') : '',
                m_desc: mat ? (mat.description || '') : '',
                spec_model: mat ? (mat.spec_model || '') : '',
                m_model: mat ? (mat.spec_model || '') : '',
                manufacturer: mat ? (mat.manufacturer || '') : '',
                m_mfr: mat ? (mat.manufacturer || '') : '',
                qty: 1,
                unit: mat ? (mat.unit || 'PC') : 'PC',
                drawing_no: mat ? (mat.drawing_no || '/') : '/',
                level_str: '●',
                level_num: 1,
                notes: mat ? (mat.notes || '') : '',
                substitute: mat ? (mat.substitute || '') : '',
                import_children: importChildren
            };

            fetch('/api/bom/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    loadBomItems(currentSubsystemId);
                    loadMasterMaterials();
                    loadMasterStats();
                    if (res.imported_children_count > 0) {
                        showToast(`总成 [${matNo}] 及其下属全部 ${res.imported_children_count} 项子零部件已导入当前 Sheet。`, 'success');
                    } else {
                        showToast(`物料 [${matNo}] 已添加到当前 Sheet。`, 'success');
                    }
                } else {
                    alert(res.error || '添加失败');
                }
            })
            .catch(err => alert('网络异常: ' + err.message));
        }

        // --- Export Master Materials Excel ---
        function exportMasterMaterialsExcel() {
            window.location.href = '/api/materials/export';
        }


        // ==========================================
        // Master Materials Excel Auto-Import & Alignment
        // ==========================================
        let currentMasterImportAnalysis = null;

        function triggerMasterExcelImport() {
            const input = document.getElementById('masterExcelUploadInput');
            if (input) {
                input.value = '';
                input.click();
            }
        }

        function handleMasterExcelFileChosen(event) {
            const file = event.target.files[0];
            if (!file) return;

            showToast('正在解析 Excel 表格与列结构...', 'info');

            const formData = new FormData();
            formData.append('file', file);

            fetch('/api/materials/import/analyze', {
                method: 'POST',
                body: formData
            })
            .then(r => r.json())
            .then(res => {
                if (res.error) {
                    alert(res.error);
                    return;
                }

                currentMasterImportAnalysis = res;

                if (res.is_certain) {
                    // All headers aligned with template perfectly
                    const confirmMsg = `检测到表格列与标准模版标题对齐。\n已识别字段：物料号、元器件名称、完整描述、型号、厂商、单位等。\n包含约 ${res.total_rows} 项物料数据。\n\n【确定】直接开始导入\n【取消】查看并微调列映射`;
                    if (confirm(confirmMsg)) {
                        submitMasterImportExecute(res);
                        return;
                    }
                }

                // If uncertain or user clicked cancel to inspect, open confirmation mapping modal
                openMasterImportMappingModal(res);
            })
            .catch(err => alert('解析 Excel 异常: ' + err.message));
        }

        function openMasterImportMappingModal(data) {
            currentMasterImportAnalysis = data;

            // 1. Alert banner
            const banner = document.getElementById('importAlertBanner');
            if (data.is_certain) {
                banner.style.background = '#f0fdf4';
                banner.style.border = '1px solid #bbf7d0';
                banner.style.color = '#166534';
                banner.innerHTML = `<b>模版标题已对齐：</b> 系统已识别各字段对应列。您可以直接导入，或在下方调整映射。`;
            } else {
                banner.style.background = '#fffbeb';
                banner.style.border = '1px solid #fde68a';
                banner.style.color = '#92400e';
                const reasons = (data.uncertain_reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');
                banner.innerHTML = `
                    <div style="font-weight: 700; margin-bottom: 4px;">部分列未完全匹配，请核对以下字段映射：</div>
                    <ul style="margin: 0; padding-left: 18px; font-size: 12px;">${reasons || '<li>部分列标题非标准命名，请核实对应关系</li>'}</ul>
                `;
            }

            // 2. Sheet select
            document.getElementById('importFileNameSpan').textContent = data.original_filename || data.filename || 'Excel 文件';
            const sheetSel = document.getElementById('importSheetSelect');
            sheetSel.innerHTML = '';
            (data.sheets || []).forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                if (s === data.current_sheet) opt.selected = true;
                sheetSel.appendChild(opt);
            });

            // 3. Header row & total rows
            document.getElementById('importHeaderRowInput').value = data.header_row || 1;
            document.getElementById('importTotalRowsSpan').textContent = data.total_rows || 0;

            // 4. Populate mapping grid
            renderMappingGrid(data);

            // 5. Render live preview
            renderImportPreviewTable(data);

            openModal('masterImportMappingModal');
        }

        function renderMappingGrid(data) {
            const container = document.getElementById('mappingGridContainer');
            container.innerHTML = '';

            const fieldDefs = data.field_definitions || [];
            const headers = data.headers || [];
            const mapping = data.mapping || {};

            fieldDefs.forEach(f => {
                const formGroup = document.createElement('div');
                formGroup.className = 'form-group';
                formGroup.style.marginBottom = '6px';

                const reqMark = f.required ? '<span style="color: #ef4444; font-weight: 700;">* </span>' : '';
                const currentMappedCol = mapping[f.key];

                let badgeHtml = '';
                if (currentMappedCol) {
                    badgeHtml = `<span style="font-size: 11px; background: #dcfce7; color: #166534; padding: 1px 5px; border-radius: 3px; font-weight: normal; margin-left: 6px;">已匹配</span>`;
                } else if (f.required) {
                    badgeHtml = `<span style="font-size: 11px; background: #fee2e2; color: #991b1b; padding: 1px 5px; border-radius: 3px; font-weight: normal; margin-left: 6px;">必填映射</span>`;
                } else {
                    badgeHtml = `<span style="font-size: 11px; color: #94a3b8; font-weight: normal; margin-left: 6px;">未匹配</span>`;
                }

                formGroup.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <label class="form-label" style="margin: 0; font-size: 12px; font-weight: 600;">${reqMark}${escapeHtml(f.label)}:</label>
                        <div>${badgeHtml}</div>
                    </div>
                    <select class="form-select mapping-select" data-field="${f.key}" style="font-size: 12px; padding: 5px 8px;" onchange="onMappingSelectionChange()">
                        <option value="">-- 未映射 (跳过此字段) --</option>
                        ${headers.map(h => `<option value="${h.col_idx}" ${currentMappedCol === h.col_idx ? 'selected' : ''}>第 ${h.col_idx} 列: ${escapeHtml(h.title)}</option>`).join('')}
                    </select>
                `;
                container.appendChild(formGroup);
            });
        }

        function onMappingSelectionChange() {
            if (!currentMasterImportAnalysis) return;
            const newMapping = {};
            document.querySelectorAll('.mapping-select').forEach(sel => {
                const fieldKey = sel.getAttribute('data-field');
                const val = sel.value;
                if (val) {
                    newMapping[fieldKey] = parseInt(val);
                }
            });
            currentMasterImportAnalysis.mapping = newMapping;
            renderImportPreviewTable(currentMasterImportAnalysis);
        }

        function renderImportPreviewTable(data) {
            const thead = document.getElementById('importPreviewTableHead');
            const tbody = document.getElementById('importPreviewTableBody');
            thead.innerHTML = '';
            tbody.innerHTML = '';

            const headers = data.headers || [];
            const previewRows = data.preview_rows || [];
            const mapping = data.mapping || {};

            // Reverse map: col_idx -> field_label
            const colToField = {};
            (data.field_definitions || []).forEach(f => {
                const col = mapping[f.key];
                if (col) colToField[col] = f.label;
            });

            // Header row
            const trHead = document.createElement('tr');
            headers.forEach(h => {
                const th = document.createElement('th');
                const mappedField = colToField[h.col_idx];
                if (mappedField) {
                    th.style.background = '#dbeafe';
                    th.style.color = '#1e40af';
                    th.innerHTML = `<div>${escapeHtml(h.title)}</div><div style="font-size: 10px; color: #2563eb; font-weight: 700;">&rarr; ${escapeHtml(mappedField)}</div>`;
                } else {
                    th.textContent = h.title;
                }
                trHead.appendChild(th);
            });
            thead.appendChild(trHead);

            if (previewRows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="${headers.length}" style="text-align: center; color: var(--text-muted); padding: 20px;">暂无数据行预览</td></tr>`;
                return;
            }

            previewRows.forEach(r => {
                const tr = document.createElement('tr');
                headers.forEach(h => {
                    const td = document.createElement('td');
                    const val = r.cells[h.col_idx] || '';
                    if (colToField[h.col_idx]) {
                        td.style.background = '#f0f9ff';
                        td.style.fontWeight = '500';
                    }
                    td.innerHTML = `<div class="cell-text-ellipsis" style="max-width: 140px;" title="${escapeHtml(val)}">${escapeHtml(val)}</div>`;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        }

        function onImportSheetChange(sheetName) {
            if (!currentMasterImportAnalysis) return;
            showToast(`正在重新分析工作表 [${sheetName}]...`, 'info');

            fetch('/api/materials/import/reanalyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    temp_filename: currentMasterImportAnalysis.temp_filename,
                    sheet_name: sheetName
                })
            })
            .then(r => r.json())
            .then(res => {
                if (res.error) {
                    alert(res.error);
                    return;
                }
                openMasterImportMappingModal(res);
            })
            .catch(err => alert('切换工作表失败: ' + err.message));
        }

        function onImportHeaderRowChange(val) {
            if (!currentMasterImportAnalysis) return;
            currentMasterImportAnalysis.header_row = parseInt(val) || 1;
        }

        function submitMasterImportExecute(analysisData = null) {
            const data = analysisData || currentMasterImportAnalysis;
            if (!data) return;

            const mapping = {};
            if (!analysisData) {
                document.querySelectorAll('.mapping-select').forEach(sel => {
                    const fieldKey = sel.getAttribute('data-field');
                    const val = sel.value;
                    if (val) {
                        mapping[fieldKey] = parseInt(val);
                    }
                });
            } else {
                Object.assign(mapping, data.mapping);
            }

            if (!mapping.material_no) {
                alert('必须指定"物料号"对应的Excel列！');
                return;
            }

            const btn = document.getElementById('btnSubmitMasterImport');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '正在导入物料...';
            }

            const overwrite = document.getElementById('importOverwriteCheck') ? document.getElementById('importOverwriteCheck').checked : true;
            const headerRow = document.getElementById('importHeaderRowInput') ? parseInt(document.getElementById('importHeaderRowInput').value) || data.header_row : data.header_row;
            const sheetName = document.getElementById('importSheetSelect') ? document.getElementById('importSheetSelect').value : data.current_sheet;

            fetch('/api/materials/import/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    temp_filename: data.temp_filename,
                    sheet_name: sheetName,
                    header_row: headerRow,
                    mapping: mapping,
                    overwrite: overwrite
                })
            })
            .then(r => r.json())
            .then(res => {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '确认导入';
                }

                if (res.success) {
                    closeModal('masterImportMappingModal');
                    showToast(res.message || '物料数据导入成功。', 'success');
                    loadMasterMaterials();
                    loadMasterStats();
                    if (currentSubsystemId) {
                        loadBomItems(currentSubsystemId);
                    }
                } else {
                    alert(res.error || '导入失败');
                }
            })
            .catch(err => {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '确认导入';
                }
                alert('网络异常: ' + err.message);
            });
        }


        // --- Master Modal Maximize / Restore ---
        function toggleMasterModalMaximize() {
            const dlg = document.getElementById('masterModalDialog');
            const btn = document.getElementById('masterModalMaxBtn');
            if (!dlg) return;

            const isMax = dlg.classList.toggle('maximized');
            if (btn) {
                if (isMax) {
                    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4.5" y="1.5" width="10" height="10" rx="1"/><path d="M1.5 5.5v9a1 1 0 0 0 1 1h9"/></svg>';
                    btn.title = '还原窗口';
                } else {
                    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="12" height="12" rx="1.5"/></svg>';
                    btn.title = '最大化窗口';
                }
            }
            setTimeout(() => {
                applyColumnWidths('masterTable');
            }, 50);
        }

        // ==========================================
        // AI Large Language Model Extraction Handlers
        // ==========================================
        function highlightField(elem) {
            if (!elem) return;
            const origTransition = elem.style.transition;
            const origBorder = elem.style.borderColor;
            const origBg = elem.style.backgroundColor;
            elem.style.transition = 'all 0.3s ease';
            elem.style.borderColor = '#2563eb';
            elem.style.backgroundColor = '#eff6ff';
            setTimeout(() => {
                elem.style.borderColor = origBorder;
                elem.style.backgroundColor = origBg;
                elem.style.transition = origTransition;
            }, 1800);
        }

        async function aiExtractMasterItem() {
            const descInput = document.getElementById('mm-description');
            const desc = (descInput ? descInput.value : '').trim();
            if (!desc) {
                alert('请先输入或粘贴物料描述，然后再点击【大模型智能提取】！');
                if (descInput) descInput.focus();
                return;
            }

            const btn = document.getElementById('btn-ai-parse-mm');
            const origHtml = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span>⏳ 大模型推断中...</span>';
                btn.style.opacity = '0.75';
            }

            try {
                const resp = await fetch('/api/materials/ai-parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: desc })
                });
                const res = await resp.json();
                if (!res.success) {
                    alert('大模型推断失败: ' + (res.error || '未知错误'));
                    return;
                }

                const data = res.data || {};
                const nameInput = document.getElementById('mm-name');
                if (nameInput && data.name) {
                    nameInput.value = data.name;
                    highlightField(nameInput);
                }

                const specInput = document.getElementById('mm-spec-model');
                if (specInput && data.spec_model) {
                    specInput.value = data.spec_model;
                    highlightField(specInput);
                }

                const mfrInput = document.getElementById('mm-manufacturer');
                if (mfrInput && data.manufacturer) {
                    mfrInput.value = data.manufacturer;
                    highlightField(mfrInput);
                }

                if (typeof triggerRealtimeDuplicateCheck === 'function') {
                    triggerRealtimeDuplicateCheck();
                }

                const costStr = data.cost_seconds ? ` (耗时 ${data.cost_seconds}s)` : '';
                const engineTag = res.engine === 'local_llm' ? '离线大模型' : '智能引擎';
                if (typeof showToast === 'function') {
                    showToast(`✨ ${engineTag}推断成功${costStr}：名称【${data.name || '-'}】、型号【${data.spec_model || '-'}】、制造商【${data.manufacturer || '-'}】`, 'success');
                }
            } catch (e) {
                alert('请求大模型服务异常: ' + e.message);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = origHtml;
                    btn.style.opacity = '1';
                }
            }
        }

        async function aiExtractBomItem() {
            const descInput = document.getElementById('bm-desc');
            const desc = (descInput ? descInput.value : '').trim();
            if (!desc) {
                alert('请先输入或粘贴物料描述，然后再点击【大模型智能提取】！');
                if (descInput) descInput.focus();
                return;
            }

            const btn = document.getElementById('btn-ai-parse-bm');
            const origHtml = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span>⏳ 大模型推断中...</span>';
                btn.style.opacity = '0.75';
            }

            try {
                const resp = await fetch('/api/materials/ai-parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: desc })
                });
                const res = await resp.json();
                if (!res.success) {
                    alert('大模型推断失败: ' + (res.error || '未知错误'));
                    return;
                }

                const data = res.data || {};
                const nameInput = document.getElementById('bm-name');
                if (nameInput && data.name) {
                    nameInput.value = data.name;
                    highlightField(nameInput);
                }

                const modelInput = document.getElementById('bm-model');
                if (modelInput && data.spec_model) {
                    modelInput.value = data.spec_model;
                    highlightField(modelInput);
                }

                const mfrInput = document.getElementById('bm-mfr');
                if (mfrInput && data.manufacturer) {
                    mfrInput.value = data.manufacturer;
                    highlightField(mfrInput);
                }

                const costStr = data.cost_seconds ? ` (耗时 ${data.cost_seconds}s)` : '';
                const engineTag = res.engine === 'local_llm' ? '离线大模型' : '智能引擎';
                if (typeof showToast === 'function') {
                    showToast(`✨ ${engineTag}推断成功${costStr}：名称【${data.name || '-'}】、型号【${data.spec_model || '-'}】、制造商【${data.manufacturer || '-'}】`, 'success');
                }
            } catch (e) {
                alert('请求大模型服务异常: ' + e.message);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = origHtml;
                    btn.style.opacity = '1';
                }
            }
        }

        window.aiExtractMasterItem = aiExtractMasterItem;
        window.aiExtractBomItem = aiExtractBomItem;
        window.highlightField = highlightField;



