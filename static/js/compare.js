// ==========================================
// Service BOM - Project BOM Comparison
// ==========================================

        // ==========================================
        // Project BOM Comparison Functions
        // ==========================================
        let currentCompareData = null;
        let currentCompareFilter = 'diff'; // 'diff', 'added', 'removed', 'modified', 'same', 'all'
        let currentCompareSortField = ''; // '', 'status', 'material_no', 'name', 'a_qty', 'b_qty', 'qty_diff'
        let currentCompareSortDir = 'asc';
        let isExecutingCompare = false;

        function _getCompareParams() {
            const selA = document.getElementById('compareProjA');
            const selB = document.getElementById('compareProjB');
            const selSub = document.getElementById('compareSubsystemSelect');
            const selMode = document.getElementById('compareModeSelect');
            return {
                projAId: selA ? selA.value : '',
                projBId: selB ? selB.value : '',
                subsystem: selSub ? selSub.value : 'all',
                mode: (selMode && selMode.value === 'strict') ? 'strict' : 'material'
            };
        }

        async function openProjectCompareModal(defaultProjAId = null, defaultProjBId = null) {
            try {
                // 1. Fetch latest projects list
                const projects = await safeFetchJson('/api/projects');
                if (!projects || projects.length === 0) {
                    alert('当前系统中暂无工程项目，请先新建或导入工程项目！');
                    return;
                }

                if (projects.length === 1) {
                    const p = projects[0];
                    const pTitle = formatProjectDisplayName(p) || '当前项目';
                    if (confirm(`当前系统中仅有 1 个项目【${pTitle}】。\n\n比对功能需要至少 2 个项目。您是否要先【快速复制】该项目作为新版本，然后再进行比对分析？`)) {
                        openCopyProjectModal();
                    }
                    return;
                }

                // 2. Populate Select A and Select B
                const selA = document.getElementById('compareProjA');
                const selB = document.getElementById('compareProjB');
                selA.innerHTML = '';
                selB.innerHTML = '';

                let chosenA = defaultProjAId || currentProjectId || (projects[0] ? projects[0].id : null);
                let chosenB = defaultProjBId || null;

                // Pick B different from A if possible
                if (!chosenB) {
                    const other = projects.find(p => p.id != chosenA);
                    chosenB = other ? other.id : chosenA;
                }

                projects.forEach(p => {
                    const label = formatProjectDisplayName(p);
                    
                    const optA = document.createElement('option');
                    optA.value = p.id;
                    optA.textContent = label;
                    if (p.id == chosenA) optA.selected = true;
                    selA.appendChild(optA);

                    const optB = document.createElement('option');
                    optB.value = p.id;
                    optB.textContent = label;
                    if (p.id == chosenB) optB.selected = true;
                    selB.appendChild(optB);
                });

                openModal('projectCompareModal');

                // 3. Load subsystems and trigger comparison
                await updateCompareSubsystemOptions();
                executeProjectCompare();

            } catch (err) {
                alert('打开项目比对失败: ' + err.message);
            }
        }

        async function updateCompareSubsystemOptions() {
            const selA = document.getElementById('compareProjA');
            const selB = document.getElementById('compareProjB');
            const selSub = document.getElementById('compareSubsystemSelect');
            if (!selSub || !selA || !selB) return;

            const projAId = selA.value;
            const projBId = selB.value;
            if (!projAId || !projBId) return;

            try {
                const [dataA, dataB] = await Promise.all([
                    safeFetchJson(`/api/project/${projAId}`),
                    safeFetchJson(`/api/project/${projBId}`)
                ]);

                const subsA = (dataA && dataA.subsystems) ? dataA.subsystems.map(s => s.name) : [];
                const subsB = (dataB && dataB.subsystems) ? dataB.subsystems.map(s => s.name) : [];
                const unionSubs = Array.from(new Set([...subsA, ...subsB]));

                const currentVal = selSub.value;
                selSub.innerHTML = '<option value="all">全部子系统 (整机汇总)</option>';
                unionSubs.forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = `子系统 Sheet: ${name}`;
                    if (name === currentVal) opt.selected = true;
                    selSub.appendChild(opt);
                });
            } catch (e) {
                console.warn('Failed to load subsystems for compare dropdown:', e);
            }
        }

        async function onCompareProjectChange() {
            await updateCompareSubsystemOptions();
            executeProjectCompare();
        }

        function swapCompareProjects() {
            const selA = document.getElementById('compareProjA');
            const selB = document.getElementById('compareProjB');
            if (!selA || !selB) return;
            const temp = selA.value;
            selA.value = selB.value;
            selB.value = temp;
            executeProjectCompare();
        }

        async function executeProjectCompare() {
            if (isExecutingCompare) return;

            const spinner = document.getElementById('compareLoadingSpinner');
            const tbody = document.getElementById('compareTableBody');
            const { projAId, projBId, subsystem, mode } = _getCompareParams();

            if (!projAId || !projBId) {
                alert('请先选择需要比对的两个项目！');
                return;
            }

            isExecutingCompare = true;
            if (spinner) spinner.style.display = 'flex';

            try {
                const url = `/api/projects/compare?source_id=${projAId}&target_id=${projBId}&subsystem=${encodeURIComponent(subsystem)}&mode=${encodeURIComponent(mode)}`;
                const res = await safeFetchJson(url);

                if (!res || !res.success) {
                    alert((res && res.error) || '比对分析失败');
                    if (tbody) {
                        tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; color: #dc2626; padding: 30px;">比对失败: ${escapeHtml((res && res.error) || '未知错误')}</td></tr>`;
                    }
                    return;
                }

                currentCompareData = res;

                // Update Table Header project titles
                const thA = document.getElementById('thProjATitle');
                const thB = document.getElementById('thProjBTitle');
                if (thA) thA.textContent = `【基准项目 A】${res.project_a.display_name}`;
                if (thB) thB.textContent = `【比对项目 B】${res.project_b.display_name}`;

                // Update Overview Cards
                updateCompareMetricsDisplay(res);

                // Auto-set filter pill: default to 'diff' if diffs exist, otherwise 'all'
                if (res.summary.diff_total > 0) {
                    currentCompareFilter = 'diff';
                } else {
                    currentCompareFilter = 'all';
                }
                updateCompareFilterPillsUI();
                updateCompareSortIndicators();

                // Render table
                renderCompareTable();

            } catch (err) {
                alert('比对过程发生异常: ' + err.message);
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; color: #dc2626; padding: 30px;">请求异常: ${escapeHtml(err.message)}</td></tr>`;
                }
            } finally {
                isExecutingCompare = false;
                if (spinner) spinner.style.display = 'none';
            }
        }

        function updateCompareMetricsDisplay(res) {
            const pa = res.project_a;
            const pb = res.project_b;
            const s = res.summary;
            const isMaterialMode = (res.compare_mode !== 'strict');

            // Project A Card
            const elA_name = document.getElementById('compareStatA_name');
            const elA_code = document.getElementById('compareStatA_code');
            const elA_types = document.getElementById('compareStatA_types');
            const elA_pieces = document.getElementById('compareStatA_pieces');
            if (elA_name) {
                elA_name.textContent = pa.display_name;
                elA_name.title = pa.display_name;
            }
            if (elA_code) elA_code.textContent = pa.code || '无代号';
            if (elA_types) elA_types.textContent = pa.material_types_count;
            if (elA_pieces) elA_pieces.textContent = pa.total_pieces;

            // Project B Card
            const elB_name = document.getElementById('compareStatB_name');
            const elB_code = document.getElementById('compareStatB_code');
            const elB_types = document.getElementById('compareStatB_types');
            const elB_pieces = document.getElementById('compareStatB_pieces');
            if (elB_name) {
                elB_name.textContent = pb.display_name;
                elB_name.title = pb.display_name;
            }
            if (elB_code) elB_code.textContent = pb.code || '无代号';
            if (elB_types) elB_types.textContent = pb.material_types_count;
            if (elB_pieces) elB_pieces.textContent = pb.total_pieces;

            // Diff Metric Numbers & Mode Labels
            const elAdded = document.getElementById('compareStat_added');
            const elRemoved = document.getElementById('compareStat_removed');
            const elModified = document.getElementById('compareStat_modified');
            const elSame = document.getElementById('compareStat_same');
            const elModTitle = document.getElementById('compareStatModifiedTitle');
            const elModSub = document.getElementById('compareStatModifiedSub');
            const elSameTitle = document.getElementById('compareStatSameTitle');
            const elSameSub = document.getElementById('compareStatSameSub');

            if (elAdded) elAdded.textContent = `+${s.added}`;
            if (elRemoved) elRemoved.textContent = `-${s.removed}`;
            if (elModified) elModified.textContent = s.modified;
            if (elSame) elSame.textContent = s.same;

            if (elModTitle) elModTitle.textContent = isMaterialMode ? '🟡 数量/单位差异 (≠)' : '🟡 属性/数量差异 (≠)';
            if (elModSub) elModSub.textContent = isMaterialMode ? '同物料号用量或单位变化' : '数量/层级/图号/备注变化';
            if (elSameTitle) elSameTitle.textContent = isMaterialMode ? '⚪ 物料一致 (=)' : '⚪ 完全一致 (=)';
            if (elSameSub) {
                const overlapTxt = (s.overlap_rate !== undefined) ? `物料号重合率 ${s.overlap_rate}% (共有 ${s.common_materials || 0} 种)` : '无任何变化物料';
                elSameSub.textContent = overlapTxt;
            }

            // Pill counts & Labels
            const pModLabel = document.getElementById('pillLabel_modified');
            const pSameLabel = document.getElementById('pillLabel_same');
            if (pModLabel) pModLabel.textContent = isMaterialMode ? '🟡 数量/单位差异' : '🟡 属性差异';
            if (pSameLabel) pSameLabel.textContent = isMaterialMode ? '⚪ 物料一致' : '⚪ 完全一致';

            const pDiff = document.getElementById('pillCount_diff');
            const pAdded = document.getElementById('pillCount_added');
            const pRemoved = document.getElementById('pillCount_removed');
            const pModified = document.getElementById('pillCount_modified');
            const pSame = document.getElementById('pillCount_same');
            const pAll = document.getElementById('pillCount_all');

            if (pDiff) pDiff.textContent = s.diff_total;
            if (pAdded) pAdded.textContent = s.added;
            if (pRemoved) pRemoved.textContent = s.removed;
            if (pModified) pModified.textContent = s.modified;
            if (pSame) pSame.textContent = s.same;
            if (pAll) pAll.textContent = s.total_unique;
        }

        function sortCompareTable(field) {
            if (currentCompareSortField === field) {
                if (currentCompareSortDir === 'asc') {
                    currentCompareSortDir = 'desc';
                } else {
                    currentCompareSortField = '';
                    currentCompareSortDir = 'asc';
                }
            } else {
                currentCompareSortField = field;
                currentCompareSortDir = (field === 'qty_diff' || field === 'a_qty' || field === 'b_qty') ? 'desc' : 'asc';
            }
            updateCompareSortIndicators();
            renderCompareTable();
        }

        function updateCompareSortIndicators() {
            const fields = ['status', 'material_no', 'name', 'qty_diff', 'a_qty', 'b_qty'];
            fields.forEach(f => {
                const el = document.getElementById(`cmpSort_${f}`);
                if (!el) return;
                if (currentCompareSortField === f) {
                    el.textContent = currentCompareSortDir === 'asc' ? '▲' : '▼';
                    el.style.color = '#2563eb';
                } else {
                    el.textContent = '⇅';
                    el.style.color = '#94a3b8';
                }
            });
        }

        function setCompareFilter(filterKey) {
            currentCompareFilter = filterKey;
            updateCompareFilterPillsUI();
            renderCompareTable();
        }

        function updateCompareFilterPillsUI() {
            document.querySelectorAll('#compareFilterPillsGroup .compare-filter-pill').forEach(btn => {
                const f = btn.getAttribute('data-filter');
                if (f === currentCompareFilter) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        function onCompareFilterChanged() {
            renderCompareTable();
        }

        function renderCompareTable() {
            const tbody = document.getElementById('compareTableBody');
            const footerSummary = document.getElementById('compareFooterSummary');
            if (!tbody) return;

            if (!currentCompareData || !currentCompareData.items) {
                tbody.innerHTML = `<tr><td colspan="15" style="padding: 40px; text-align: center; color: #94a3b8;">暂无比对数据</td></tr>`;
                return;
            }

            const rawSearch = (document.getElementById('compareSearchInput')?.value || '').trim().toLowerCase();
            // Support comma/semicolon/newline-separated batch material list (OR), or space-separated multi-term narrowing (AND)
            const hasListSep = /[,;，；\n]/.test(rawSearch);
            const listTokens = hasListSep ? rawSearch.split(/[,;，；\s\n]+/).filter(Boolean) : [];
            const andTokens = (!hasListSep && rawSearch) ? rawSearch.split(/\s+/).filter(Boolean) : [];
            const filter = currentCompareFilter;

            let filtered = currentCompareData.items.filter(it => {
                // 1. Status Filter
                if (filter === 'diff' && it.status === 'same') return false;
                if (filter === 'added' && it.status !== 'added') return false;
                if (filter === 'removed' && it.status !== 'removed') return false;
                if (filter === 'modified' && it.status !== 'modified') return false;
                if (filter === 'same' && it.status !== 'same') return false;

                // 2. Keyword / Batch Material Search
                if (rawSearch) {
                    const text = [
                        it.material_no,
                        it.name,
                        it.description,
                        it.spec_model,
                        it.manufacturer,
                        ...(it.diff_changes || []).map(c => c.desc),
                        ...(it.minor_changes || []).map(c => c.desc)
                    ].filter(Boolean).join(' ').toLowerCase();

                    if (listTokens.length > 0) {
                        if (!listTokens.some(tok => text.includes(tok))) return false;
                    } else if (andTokens.length > 0) {
                        if (!andTokens.every(tok => text.includes(tok))) return false;
                    }
                }

                return true;
            });

            if (currentCompareSortField) {
                const statusRank = { added: 1, removed: 2, modified: 3, same: 4 };
                const mul = currentCompareSortDir === 'asc' ? 1 : -1;
                filtered = filtered.slice().sort((x, y) => {
                    let cmp = 0;
                    if (currentCompareSortField === 'status') {
                        cmp = (statusRank[x.status] || 9) - (statusRank[y.status] || 9);
                    } else if (currentCompareSortField === 'material_no') {
                        cmp = String(x.material_no || '').localeCompare(String(y.material_no || ''), 'zh-CN');
                    } else if (currentCompareSortField === 'name') {
                        cmp = String(x.name || '').localeCompare(String(y.name || ''), 'zh-CN');
                    } else if (currentCompareSortField === 'a_qty') {
                        cmp = (x.a?.total_qty || 0) - (y.a?.total_qty || 0);
                    } else if (currentCompareSortField === 'b_qty') {
                        cmp = (x.b?.total_qty || 0) - (y.b?.total_qty || 0);
                    } else if (currentCompareSortField === 'qty_diff') {
                        cmp = (x.qty_diff || 0) - (y.qty_diff || 0);
                    }
                    return cmp !== 0 ? cmp * mul : String(x.material_no || '').localeCompare(String(y.material_no || ''));
                });
            }

            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="15" style="padding: 36px; text-align: center; color: #94a3b8; font-size: 13px;">当前筛选条件下未找到匹配的物料记录</td></tr>`;
                if (footerSummary) {
                    footerSummary.textContent = `共 ${currentCompareData.items.length} 项物料，当前筛选显示 0 项`;
                }
                return;
            }

            const isMaterialMode = (currentCompareData.compare_mode !== 'strict');

            const _renderOccBadge = (groupObj) => {
                const cnt = groupObj.occurrences_count || 0;
                if (cnt <= 1) return '';
                const refs = (groupObj.row_refs || []).join('\n');
                return `<span title="同物料号跨多行自动汇总数量：\n${escapeHtml(refs)}" style="display:inline-block; margin-left:4px; background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; border-radius:4px; padding:0 4px; font-size:10px; font-weight:600; cursor:help;">合并${cnt}行</span>`;
            };

            const rowsHtml = filtered.map((it, idx) => {
                const st = it.status;
                let badgeHtml = '';
                let trBg = '';

                if (st === 'added') {
                    badgeHtml = `<span class="badge-diff-added">+ 目标新增</span>`;
                    trBg = 'background: #f0fdf4;';
                } else if (st === 'removed') {
                    badgeHtml = `<span class="badge-diff-removed">- 目标减少</span>`;
                    trBg = 'background: #fef2f2;';
                } else if (st === 'modified') {
                    badgeHtml = `<span class="badge-diff-modified">${escapeHtml('≠ ' + (it.status_label || (isMaterialMode ? '数量差异' : '属性差异')))}</span>`;
                    trBg = 'background: #fffbeb;';
                } else {
                    badgeHtml = `<span class="badge-diff-same">${escapeHtml('= ' + (it.status_label || (isMaterialMode ? '物料一致' : '完全一致')))}</span>`;
                    trBg = idx % 2 === 1 ? 'background: #f8fafc;' : '';
                }

                const ia = it.a || {};
                const ib = it.b || {};

                // Qty Diff text styling
                let qtyDiffHtml = '<span style="color: #94a3b8;">0</span>';
                if (it.qty_diff > 0) {
                    qtyDiffHtml = `<span style="color: #15803d; font-weight: 700; font-family: monospace;">+${escapeHtml(it.qty_diff_text.replace('+', ''))}</span>`;
                } else if (it.qty_diff < 0) {
                    qtyDiffHtml = `<span style="color: #b91c1c; font-weight: 700; font-family: monospace;">${escapeHtml(it.qty_diff_text)}</span>`;
                }

                // Diff changes badges + minor reference changes
                let changesHtml = '';
                if (it.diff_changes && it.diff_changes.length > 0) {
                    changesHtml = it.diff_changes.map(c => {
                        let cBg = '#eff6ff';
                        let cColor = '#1e40af';
                        let cBorder = '#bfdbfe';
                        if (c.type === 'added') {
                            cBg = '#dcfce7'; cColor = '#166534'; cBorder = '#bbf7d0';
                        } else if (c.type === 'removed') {
                            cBg = '#fee2e2'; cColor = '#991b1b'; cBorder = '#fecaca';
                        } else if (c.type === 'qty') {
                            cBg = '#fef3c7'; cColor = '#92400e'; cBorder = '#fde68a';
                        }
                        return `<span style="display: inline-block; background: ${cBg}; color: ${cColor}; border: 1px solid ${cBorder}; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin: 2px 4px 2px 0;">${escapeHtml(c.desc)}</span>`;
                    }).join('');
                }
                if (it.minor_changes && it.minor_changes.length > 0) {
                    const minorHtml = it.minor_changes.map(c =>
                        `<span style="display: inline-block; background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; padding: 1px 5px; border-radius: 4px; font-size: 11px; margin: 2px 4px 2px 0;" title="仅属性分布参考差异，不计入物料核心差异">${escapeHtml('参考: ' + c.desc)}</span>`
                    ).join('');
                    changesHtml += minorHtml;
                }
                if (!changesHtml) {
                    changesHtml = `<span style="color: #94a3b8; font-size: 11px;">${isMaterialMode ? '物料号与单机用量一致' : '两项目配置一致'}</span>`;
                }

                // Group A Cells
                const aQty = ia.exists ? `<b style="font-family: monospace;">${escapeHtml(ia.total_qty_str)}</b> <span style="font-size: 11px; color: #64748b;">${escapeHtml(ia.unit)}</span>${_renderOccBadge(ia)}` : '<span style="color: #cbd5e1;">-</span>';
                const aLvl = ia.exists ? `<span style="font-size: 11px; font-weight: 500;">${escapeHtml(ia.level_str || '')} ${ia.level_num ? ia.level_num + '级' : ''}</span>` : '<span style="color: #cbd5e1;">-</span>';
                const aDwg = ia.exists ? (formatPipeMultilineHtml(ia.drawing_no || '/') || '<span style="color: #cbd5e1;">-</span>') : '<span style="color: #cbd5e1;">-</span>';
                const aSheet = ia.exists ? `<span class="cell-text-ellipsis" style="max-width: 80px; color: #1e40af;" title="${escapeHtml((ia.subsystems || []).join(', '))}">[${escapeHtml((ia.subsystems || []).join(','))}]</span>` : '<span style="color: #cbd5e1;">-</span>';

                // Group B Cells
                const bQty = ib.exists ? `<b style="font-family: monospace;">${escapeHtml(ib.total_qty_str)}</b> <span style="font-size: 11px; color: #64748b;">${escapeHtml(ib.unit)}</span>${_renderOccBadge(ib)}` : '<span style="color: #cbd5e1;">-</span>';
                const bLvl = ib.exists ? `<span style="font-size: 11px; font-weight: 500;">${escapeHtml(ib.level_str || '')} ${ib.level_num ? ib.level_num + '级' : ''}</span>` : '<span style="color: #cbd5e1;">-</span>';
                const bDwg = ib.exists ? (formatPipeMultilineHtml(ib.drawing_no || '/') || '<span style="color: #cbd5e1;">-</span>') : '<span style="color: #cbd5e1;">-</span>';
                const bSheet = ib.exists ? `<span class="cell-text-ellipsis" style="max-width: 80px; color: #166534;" title="${escapeHtml((ib.subsystems || []).join(', '))}">[${escapeHtml((ib.subsystems || []).join(','))}]</span>` : '<span style="color: #cbd5e1;">-</span>';

                const specMfr = [it.spec_model, it.manufacturer].filter(Boolean).join(' / ') || '-';

                return `
                    <tr style="border-bottom: 1px solid #f1f5f9; ${trBg}">
                        <td style="padding: 6px 8px; text-align: center; color: #94a3b8; font-family: monospace; border-right: 1px solid #f1f5f9;">${idx + 1}</td>
                        <td style="padding: 6px 10px; text-align: center; border-right: 1px solid #f1f5f9;">${badgeHtml}</td>
                        <td style="padding: 6px 10px; font-family: monospace; font-weight: 700; color: #0f172a; border-right: 1px solid #f1f5f9; cursor: pointer;" data-mat="${escapeHtml(it.material_no)}" onclick="copyCompareMatNo(this.getAttribute('data-mat'))" title="点击复制物料号">${formatPipeMultilineMatNo(it.material_no)}</td>
                        <td style="padding: 6px 10px; font-weight: 600; color: #334155; border-right: 1px solid #f1f5f9;">
                            ${formatPipeMultilineHtml(it.name || '-')}
                        </td>
                        <td style="padding: 6px 10px; color: #64748b; border-right: 1px solid #f1f5f9;">
                            ${formatPipeMultilineHtml(specMfr)}
                        </td>
                        <!-- A Cols -->
                        <td style="padding: 6px 8px; text-align: right; border-right: 1px solid #f1f5f9; background: rgba(239, 246, 255, 0.4);">${aQty}</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #f1f5f9; background: rgba(239, 246, 255, 0.4);">${aLvl}</td>
                        <td style="padding: 6px 8px; border-right: 1px solid #f1f5f9; background: rgba(239, 246, 255, 0.4);">${aDwg}</td>
                        <td style="padding: 6px 8px; border-right: 1px solid #e2e8f0; background: rgba(239, 246, 255, 0.4);">${aSheet}</td>
                        <!-- B Cols -->
                        <td style="padding: 6px 8px; text-align: right; border-right: 1px solid #f1f5f9; background: rgba(240, 253, 244, 0.4);">${bQty}</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #f1f5f9; background: rgba(240, 253, 244, 0.4);">${bLvl}</td>
                        <td style="padding: 6px 8px; border-right: 1px solid #f1f5f9; background: rgba(240, 253, 244, 0.4);">${bDwg}</td>
                        <td style="padding: 6px 8px; border-right: 1px solid #e2e8f0; background: rgba(240, 253, 244, 0.4);">${bSheet}</td>
                        <!-- Qty Diff & Changes -->
                        <td style="padding: 6px 10px; text-align: center; border-right: 1px solid #f1f5f9;">${qtyDiffHtml}</td>
                        <td style="padding: 6px 10px; line-height: 1.4;">${changesHtml}</td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = rowsHtml;

            if (footerSummary) {
                const s = currentCompareData.summary;
                const overlapTxt = (s.overlap_rate !== undefined) ? `，物料号重合率 <b>${s.overlap_rate}%</b>` : '';
                footerSummary.innerHTML = `
                    <span>共涉及 <b>${currentCompareData.items.length}</b> 种物料${overlapTxt}；识别差异物料 <b style="color: #d97706;">${s.diff_total}</b> 种（目标新增: <b style="color: #15803d;">+${s.added}</b>，目标减少: <b style="color: #b91c1c;">-${s.removed}</b>，${isMaterialMode ? '数量/单位差异' : '属性变更'}: <b style="color: #b45309;">${s.modified}</b>，${isMaterialMode ? '物料一致' : '完全一致'}: <b>${s.same}</b>）；当前显示 <b>${filtered.length}</b> 项。</span>
                `;
            }
        }

        function exportCompareReportExcel() {
            const { projAId, projBId, subsystem, mode } = _getCompareParams();
            if (!projAId || !projBId) {
                alert('请先选择比对项目！');
                return;
            }

            showToast('正在生成并导出 BOM 对比分析报表 (.xlsx)...', 'info');
            const url = `/api/projects/compare/export?source_id=${projAId}&target_id=${projBId}&subsystem=${encodeURIComponent(subsystem)}&mode=${encodeURIComponent(mode)}`;
            window.location.href = url;
        }

        function exportProcurementExcel() {
            const { projAId, projBId, subsystem, mode } = _getCompareParams();
            if (!projAId || !projBId) {
                alert('请先选择比对项目！');
                return;
            }

            showToast('正在筛选新增与增量需求物料，生成采购申报清单 (.xlsx)...', 'info');
            const url = `/api/projects/compare/export_procurement?source_id=${projAId}&target_id=${projBId}&subsystem=${encodeURIComponent(subsystem)}&mode=${encodeURIComponent(mode)}`;
            window.location.href = url;
        }

        let currentCompareEcnData = null;

        async function openCompareEcnModal() {
            const { projAId, projBId, subsystem, mode } = _getCompareParams();
            if (!projAId || !projBId) {
                alert('请先选择比对项目！');
                return;
            }

            openModal('compareEcnModal');
            const previewEl = document.getElementById('compareEcnPreviewArea');
            const subTitleEl = document.getElementById('compareEcnSubtitle');
            const tipEl = document.getElementById('compareEcnStatusTip');
            if (previewEl) previewEl.textContent = '正在通过 BOM 智能比对引擎分析差异并自动撰写 ECN 变更说明...';
            if (tipEl) tipEl.textContent = '';

            try {
                const res = await safeFetchJson(`/api/projects/compare/generate_ecn?source_id=${projAId}&target_id=${projBId}&subsystem=${encodeURIComponent(subsystem)}&mode=${encodeURIComponent(mode)}`);
                if (!res || !res.success) {
                    throw new Error((res && res.error) || '生成失败');
                }
                currentCompareEcnData = res;
                if (subTitleEl && res.summary) {
                    subTitleEl.textContent = `基准: ${res.summary.proj_a_name} ➔ 目标: ${res.summary.proj_b_name} | 新增: ${res.summary.added_count} 种，停用: ${res.summary.removed_count} 种，调整: ${res.summary.modified_count} 种`;
                }
                if (previewEl) {
                    previewEl.textContent = res.ecn_markdown;
                }
            } catch (err) {
                if (previewEl) previewEl.textContent = '❌ 生成 ECN 失败: ' + err.message;
            }
        }

        function copyCompareString(text, successMsg) {
            if (!text) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    showToast(successMsg || '已复制至剪贴板！', 'success');
                }).catch(() => {
                    fallbackCopyText(text);
                });
            } else {
                fallbackCopyText(text);
            }
        }

        function copyCompareMatNo(matNo) {
            if (!matNo || matNo === '-') return;
            copyCompareString(matNo, `已复制物料号: ${matNo}`);
        }

        function copyCompareEcnText(type) {
            if (!currentCompareEcnData) {
                showToast('暂无生成的 ECN 内容', 'warning');
                return;
            }
            const textToCopy = (type === 'plain') ? currentCompareEcnData.ecn_text : currentCompareEcnData.ecn_markdown;
            copyCompareString(textToCopy, type === 'plain' ? '已复制纯文本 ECN 摘要至剪贴板！' : '已复制 Markdown 格式 ECN 至剪贴板！');
        }

        function fallbackCopyText(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try {
                document.execCommand('copy');
                showToast('已成功复制至剪贴板！', 'success');
            } catch (e) {
                prompt('请手动按 Ctrl+C 复制以下内容:', text);
            }
            document.body.removeChild(ta);
        }

        function downloadCompareEcnMarkdown() {
            if (!currentCompareEcnData || !currentCompareEcnData.ecn_markdown) {
                showToast('暂无可下载的 ECN 内容', 'warning');
                return;
            }
            const blob = new Blob([currentCompareEcnData.ecn_markdown], { type: 'text/markdown;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const summary = currentCompareEcnData.summary || {};
            const safeA = (summary.proj_a_name || '基准工程').replace(/[\\/*?:"<>|]/g, '_');
            const safeB = (summary.proj_b_name || '目标工程').replace(/[\\/*?:"<>|]/g, '_');
            a.href = url;
            a.download = `ECN变更履历草稿_${safeA}_VS_${safeB}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('已启动 ECN Markdown 文件下载', 'success');
        }

        async function applyEcnToTargetProject() {
            if (!currentCompareEcnData || !currentCompareEcnData.summary) {
                alert('暂无可导入的 ECN 数据！');
                return;
            }
            const summary = currentCompareEcnData.summary;
            const targetProjId = summary.proj_b_id;
            if (!targetProjId) {
                alert('未检测到目标工程ID！');
                return;
            }

            const promptMsg = `确定要将本次比对萃取的变更说明自动追加写入到目标工程【${summary.proj_b_name}】的 ECN 履历表中吗？`;
            if (!confirm(promptMsg)) return;

            const tipEl = document.getElementById('compareEcnStatusTip');
            const btn = document.getElementById('btnApplyEcnToProject');
            if (btn) btn.disabled = true;
            if (tipEl) tipEl.textContent = '正在写入目标工程 ECN 记录...';

            try {
                const nowStr = (typeof formatBeijingDate === 'function') ? formatBeijingDate() : new Date().toISOString().slice(0, 10);
                const bjYear = (typeof getBeijingNowParts === 'function') ? getBeijingNowParts().year : new Date().getFullYear();
                const postData = {
                    ecn_no: `ECN-${bjYear}-${Math.floor(1000 + Math.random() * 9000)}`,
                    change_desc: currentCompareEcnData.ecn_text.slice(0, 800),
                    changer: 'BOM对比系统自动生成',
                    change_date: nowStr
                };

                const res = await safeFetchJson(`/api/project/${targetProjId}/ecn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(postData)
                });

                if (res && res.success) {
                    if (tipEl) tipEl.textContent = `✅ 成功写入目标工程 ECN 记录 (单号: ${postData.ecn_no})！`;
                    showToast(`已成功录入目标工程【${summary.proj_b_name}】的 ECN 修改记录！`, 'success');
                    if (typeof loadProjectEcnRecords === 'function' && targetProjId == currentProjectId) {
                        loadProjectEcnRecords(targetProjId);
                    }
                } else {
                    throw new Error((res && res.error) || '导入失败');
                }
            } catch (err) {
                if (tipEl) tipEl.textContent = '❌ 写入失败: ' + err.message;
                alert('写入目标工程 ECN 失败: ' + err.message);
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        function toggleCompareModalMaximize() {
            const dlg = document.getElementById('projectCompareModalDialog');
            const btn = document.getElementById('compareModalMaxBtn');
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
        }


