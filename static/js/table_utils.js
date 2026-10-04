// ==========================================
// Service BOM - Table Utilities (Column Resizing & Sorting)
// ==========================================

        // ==========================================
        // Table Column Width Resizing & Persistence (BOM & Master)
        // ==========================================
        const DEFAULT_COLUMN_WIDTHS = {
            select_check: 38,
            row_num: 55,
            level_num: 95,
            seq_num: 68,
            material_no: 140,
            m_name: 180,
            m_desc: 320,
            m_model: 160,
            m_mfr: 120,
            qty: 70,
            unit: 55,
            manual: 105,
            image: 85,
            drawing_no: 140,
            notes: 140
        };

        const MIN_COLUMN_WIDTHS = {
            select_check: 38,
            row_num: 45,
            level_num: 80,
            seq_num: 50,
            material_no: 90,
            m_name: 90,
            m_desc: 110,
            m_model: 85,
            m_mfr: 75,
            qty: 50,
            unit: 40,
            manual: 85,
            image: 70,
            drawing_no: 80,
            notes: 80
        };

        const COLUMN_TITLES = {
            select_check: '选择',
            row_num: '行号',
            level_num: 'BOM层级',
            seq_num: '序号',
            material_no: '物料号',
            m_name: '元器件名称',
            m_desc: '物料完整描述',
            m_model: '型号/规格',
            m_mfr: '制造商',
            qty: '数量',
            unit: '单位',
            manual: '技术手册',
            image: '实物图片',
            drawing_no: '图纸/代号',
            notes: '补充说明'
        };

        const STORAGE_KEY_COL_WIDTHS = 'service_bom_column_widths';

        // Master Materials Table Configurations
        const DEFAULT_MASTER_COLUMN_WIDTHS = {
            mm_actions: 185,
            mm_mat_no: 140,
            mm_name: 160,
            mm_projects: 170,
            mm_desc: 280,
            mm_model: 150,
            mm_mfr: 120,
            mm_unit: 60,
            mm_drawing: 140,
            mm_image: 90,
            mm_manual: 105
        };

        const MIN_MASTER_COLUMN_WIDTHS = {
            mm_actions: 145,
            mm_mat_no: 90,
            mm_name: 80,
            mm_projects: 85,
            mm_desc: 110,
            mm_model: 80,
            mm_mfr: 75,
            mm_unit: 45,
            mm_drawing: 80,
            mm_image: 70,
            mm_manual: 80
        };

        const MASTER_COLUMN_TITLES = {
            mm_actions: '操作管理',
            mm_mat_no: '物料号',
            mm_name: '元器件名称',
            mm_projects: '引用项目',
            mm_desc: '物料完整描述',
            mm_model: '规格型号',
            mm_mfr: '制造商',
            mm_unit: '单位',
            mm_drawing: '图纸/代号',
            mm_image: '实物图片',
            mm_manual: '技术手册'
        };

        const STORAGE_KEY_MASTER_COL_WIDTHS = 'service_bom_master_column_widths';

        function getTableColConfig(tableId = 'bomTable') {
            if (tableId === 'masterTable') {
                return {
                    defaults: DEFAULT_MASTER_COLUMN_WIDTHS,
                    mins: MIN_MASTER_COLUMN_WIDTHS,
                    titles: MASTER_COLUMN_TITLES,
                    storageKey: STORAGE_KEY_MASTER_COL_WIDTHS,
                    skipCols: []
                };
            }
            return {
                defaults: DEFAULT_COLUMN_WIDTHS,
                mins: MIN_COLUMN_WIDTHS,
                titles: COLUMN_TITLES,
                storageKey: STORAGE_KEY_COL_WIDTHS,
                skipCols: ['select_check']
            };
        }

        function getSavedColumnWidths(tableId = 'bomTable') {
            const cfg = getTableColConfig(tableId);
            try {
                const raw = localStorage.getItem(cfg.storageKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object') {
                        delete parsed.action;
                        return Object.assign({}, cfg.defaults, parsed);
                    }
                }
            } catch (e) {
                console.warn('Failed to parse saved column widths for ' + tableId + ':', e);
            }
            return Object.assign({}, cfg.defaults);
        }

        function saveColumnWidths(widths, tableId = 'bomTable') {
            const cfg = getTableColConfig(tableId);
            try {
                localStorage.setItem(cfg.storageKey, JSON.stringify(widths));
            } catch (e) {
                console.warn('Failed to save column widths for ' + tableId + ':', e);
            }
        }

        function applyColumnWidths(tableId = 'bomTable') {
            const table = document.getElementById(tableId);
            if (!table) return;
            const ths = table.querySelectorAll('thead th');
            const cfg = getTableColConfig(tableId);
            const widths = getSavedColumnWidths(tableId);
            let totalTableWidth = 0;

            ths.forEach(th => {
                const colKey = th.getAttribute('data-col');
                if (colKey && widths[colKey]) {
                    const w = parseInt(widths[colKey]) || cfg.defaults[colKey] || 100;
                    th.style.width = w + 'px';
                    th.style.minWidth = w + 'px';
                    th.style.maxWidth = w + 'px';
                    totalTableWidth += w;
                } else {
                    totalTableWidth += th.offsetWidth || 100;
                }
            });

            table.style.width = totalTableWidth + 'px';
        }

        function initTableColumnResizing(tableId = 'bomTable') {
            const table = document.getElementById(tableId);
            if (!table) return;

            const cfg = getTableColConfig(tableId);

            // Apply saved widths on load
            applyColumnWidths(tableId);

            const ths = table.querySelectorAll('thead th');
            ths.forEach(th => {
                const colKey = th.getAttribute('data-col');
                if (!colKey || cfg.skipCols.includes(colKey)) return;

                th.style.position = 'sticky';
                th.style.top = '0';
                th.style.zIndex = '15';

                // Check or create col-resizer
                let resizer = th.querySelector('.col-resizer');
                if (!resizer) {
                    resizer = document.createElement('div');
                    resizer.className = 'col-resizer';
                    resizer.title = '双击恢复此列默认宽度，按住拖拽自由调整列宽';
                    th.appendChild(resizer);
                } else if (th.dataset.resizableInit === 'true') {
                    // Already initialized listeners
                    return;
                }
                th.dataset.resizableInit = 'true';

                // Prevent click on resizer from triggering table sort
                resizer.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });

                // Double click to reset this single column
                resizer.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    resetSingleColumnWidth(colKey, tableId);
                });

                // Drag to resize
                resizer.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    const startX = e.clientX;
                    const startWidth = th.offsetWidth;
                    const currentWidths = getSavedColumnWidths(tableId);
                    const minW = cfg.mins[colKey] || 45;

                    resizer.classList.add('is-resizing');
                    document.body.classList.add('table-resizing');

                    function onMouseMove(moveEvent) {
                        if (moveEvent.buttons === 0) {
                            onMouseUp(moveEvent);
                            return;
                        }
                        moveEvent.preventDefault();
                        const deltaX = moveEvent.clientX - startX;
                        const newWidth = Math.max(minW, Math.round(startWidth + deltaX));

                        currentWidths[colKey] = newWidth;
                        th.style.width = newWidth + 'px';
                        th.style.minWidth = newWidth + 'px';
                        th.style.maxWidth = newWidth + 'px';

                        // Recalculate total table width
                        let total = 0;
                        ths.forEach(h => {
                            const k = h.getAttribute('data-col');
                            total += (k && currentWidths[k]) ? currentWidths[k] : h.offsetWidth;
                        });
                        table.style.width = total + 'px';
                    }

                    function onMouseUp(upEvent) {
                        upEvent.preventDefault();
                        window.removeEventListener('mousemove', onMouseMove);
                        window.removeEventListener('mouseup', onMouseUp);

                        resizer.classList.remove('is-resizing');
                        document.body.classList.remove('table-resizing');

                        saveColumnWidths(currentWidths, tableId);
                    }

                    window.addEventListener('mousemove', onMouseMove);
                    window.addEventListener('mouseup', onMouseUp);
                });
            });
        }

        function resetSingleColumnWidth(colKey, tableId = 'bomTable') {
            const cfg = getTableColConfig(tableId);
            const widths = getSavedColumnWidths(tableId);
            if (cfg.defaults[colKey]) {
                widths[colKey] = cfg.defaults[colKey];
                saveColumnWidths(widths, tableId);
                applyColumnWidths(tableId);
                const colTitle = cfg.titles[colKey] || colKey;
                showToast(`已恢复 [${colTitle}] 默认宽度 (${cfg.defaults[colKey]}px)`, 'info');
            }
        }

        function resetAllColumnWidths(tableId = 'bomTable') {
            const cfg = getTableColConfig(tableId);
            try {
                localStorage.removeItem(cfg.storageKey);
            } catch (e) {}
            applyColumnWidths(tableId);
            showToast('已重置表格所有列为推荐默认宽度', 'success');
        }

        let currentSortField = null;
        let currentSortDir = 'none'; // 'none', 'asc', 'desc'

        const sortFieldLabels = {
            row_num: '行号',
            seq_num: '序号',
            material_no: '物料号',
            m_name: '元器件名称',
            m_desc: '物料完整描述',
            m_model: '型号/规格',
            m_mfr: '制造商',
            qty: '单机数量'
        };

        function resetTableSort() {
            currentSortField = null;
            currentSortDir = 'none';
            document.querySelectorAll('.sort-icon').forEach(icon => {
                icon.textContent = '⇅';
                icon.classList.remove('active');
            });
            const statusSpan = document.getElementById('currentSortStatusSpan');
            if (statusSpan) statusSpan.textContent = '';
            const resetBtn = document.getElementById('resetSortBtn');
            if (resetBtn) resetBtn.style.display = 'none';

            if (defaultBomItemsOrder && defaultBomItemsOrder.length > 0) {
                currentBomItems = JSON.parse(JSON.stringify(defaultBomItemsOrder));
                renderBomTable(currentBomItems);

                const itemIds = currentBomItems.map(it => it.id);
                fetch('/api/bom/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subsystem_id: currentSubsystemId, item_ids: itemIds })
                });
            } else {
                loadBomItems(currentSubsystemId);
            }
            showToast('已恢复默认排版顺序', 'info');
        }

        function handleTableSort(field) {
            if (!currentBomItems || currentBomItems.length === 0) return;

            if (!defaultBomItemsOrder || defaultBomItemsOrder.length === 0) {
                defaultBomItemsOrder = JSON.parse(JSON.stringify(currentBomItems));
            }

            if (currentSortField === field) {
                if (currentSortDir === 'asc') currentSortDir = 'desc';
                else if (currentSortDir === 'desc') currentSortDir = 'none';
                else currentSortDir = 'asc';
            } else {
                currentSortField = field;
                currentSortDir = 'asc';
            }

            // Update icons
            document.querySelectorAll('.sort-icon').forEach(icon => {
                icon.textContent = '⇅';
                icon.classList.remove('active');
            });

            if (currentSortDir === 'none') {
                resetTableSort();
                return;
            }

            const icon = document.getElementById(`sort-icon-${field}`);
            if (icon) {
                icon.textContent = currentSortDir === 'asc' ? '▲' : '▼';
                icon.classList.add('active');
            }

            const statusSpan = document.getElementById('currentSortStatusSpan');
            const label = sortFieldLabels[field] || field;
            if (statusSpan) {
                statusSpan.textContent = `[按 ${label} ${currentSortDir === 'asc' ? '正向升序 ▲' : '负向降序 ▼'}（树状层级整组协同）]`;
            }
            const resetBtn = document.getElementById('resetSortBtn');
            if (resetBtn) resetBtn.style.display = 'inline-flex';

            // Hierarchical Tree Sort
            function buildBomTree(flatItems) {
                const roots = [];
                const stack = []; // [{ node, level }]

                flatItems.forEach(item => {
                    const lvl = parseInt(item.level_num) || 2;
                    const node = { item, level: lvl, children: [] };

                    while (stack.length > 0 && stack[stack.length - 1].level >= lvl) {
                        stack.pop();
                    }

                    if (stack.length === 0) {
                        roots.push(node);
                    } else {
                        stack[stack.length - 1].node.children.push(node);
                    }

                    stack.push({ node, level: lvl });
                });

                return roots;
            }

            function sortNodeTree(nodes, fieldName, dir) {
                if (!nodes || nodes.length === 0) return;

                if (nodes.length > 1) {
                    nodes.sort((a, b) => {
                        let valA = a.item[fieldName];
                        let valB = b.item[fieldName];
                        if (valA === undefined || valA === null) valA = '';
                        if (valB === undefined || valB === null) valB = '';

                        let res = 0;
                        const numA = parseFloat(valA);
                        const numB = parseFloat(valB);
                        if (!isNaN(numA) && !isNaN(numB) && String(valA).trim() !== '' && String(valB).trim() !== '') {
                            res = numA - numB;
                        } else {
                            res = String(valA).localeCompare(String(valB), 'zh-CN', { numeric: true, sensitivity: 'base' });
                        }
                        return dir === 'asc' ? res : -res;
                    });
                }

                nodes.forEach(n => {
                    if (n.children && n.children.length > 0) {
                        sortNodeTree(n.children, fieldName, dir);
                    }
                });
            }

            function flattenBomTree(nodes) {
                const list = [];
                function traverse(nodeList) {
                    nodeList.forEach(n => {
                        list.push(n.item);
                        if (n.children && n.children.length > 0) {
                            traverse(n.children);
                        }
                    });
                }
                traverse(nodes);
                return list;
            }

            const tree = buildBomTree(currentBomItems);
            sortNodeTree(tree, field, currentSortDir);
            const sortedItems = flattenBomTree(tree);

            computeBomHierarchyNumbers(sortedItems, 'dotted');

            currentBomItems = sortedItems;
            renderBomTable(sortedItems);

            // Persist order to database (if unlocked)
            if (currentProjectData && currentProjectData.is_locked == 1) {
                showToast(`已按 [${label}] 视图排列（当前工程已锁定，排序仅供临时预览，未修改工程数据）`, 'info');
                return;
            }

            const itemIds = sortedItems.map(it => it.id);
            safeFetchJson('/api/bom/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subsystem_id: currentSubsystemId, item_ids: itemIds })
            }).then(res => {
                if (res.success) {
                    showToast(`已按 [${label}] ${currentSortDir === 'asc' ? '正向升序 ▲' : '负向降序 ▼'} 重新排列，所有子层级零部件紧密跟随！`, 'success');
                }
            }).catch(err => {
                console.error("保存排序异常:", err);
            });
        }

