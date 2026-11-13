// ==========================================
// Service BOM - Core State & Utilities
// ==========================================

        let currentProjectId = null;
        let currentProjectData = null;
        let currentSubsystemId = null;
        let currentBomItems = [];
        let allMasterMaterials = [];
        let uploadTargetMatNo = '';

        // Modal Photo Management State
        let pendingModalImgFile = null;
        let currentModalImgPath = '';
        let removeImageFlag = false;

        // Modal Manual Management State
        let pendingModalManualFile = null;
        let currentModalManualPath = '';
        let removeManualFlag = false;

        function showToast(message, type = 'info', actionOpt = null) {
            let container = document.getElementById('toastContainer');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toastContainer';
                document.body.appendChild(container);
            }
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            let icon = '<span style="color: #2563eb; font-weight: 700; margin-right: 6px;">●</span>';
            if (type === 'success') icon = '<span style="color: #16a34a; font-weight: 700; margin-right: 6px;">●</span>';
            if (type === 'error') icon = '<span style="color: #dc2626; font-weight: 700; margin-right: 6px;">●</span>';
            if (type === 'warning') icon = '<span style="color: #d97706; font-weight: 700; margin-right: 6px;">●</span>';
            toast.innerHTML = `<span style="display: inline-flex; align-items: center;">${icon}</span><span>${escapeHtml(String(message ?? ''))}</span>`;

            if (actionOpt && typeof actionOpt.onClick === 'function' && actionOpt.label) {
                const actBtn = document.createElement('button');
                actBtn.type = 'button';
                actBtn.className = 'toast-action-btn';
                actBtn.textContent = actionOpt.label;
                actBtn.onclick = (e) => {
                    e.stopPropagation();
                    toast.remove();
                    actionOpt.onClick();
                };
                toast.appendChild(actBtn);
            }

            container.appendChild(toast);
            const duration = (actionOpt && actionOpt.duration) ? actionOpt.duration : (actionOpt ? 6500 : 3500);
            setTimeout(() => {
                if (!toast.isConnected) return;
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-10px)';
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }

        function showVersionDetails() {
            safeFetchJson('/api/version')
                .then(v => {
                    const msg = `【风电机组 Service BOM 版本详情】\n\n` +
                                `• 版本代号: ${v.version || 'v2.2.0'}\n` +
                                `• Git Commit: ${v.commit_full || v.commit}\n` +
                                `• 提交时间: ${v.date || '未知'}\n` +
                                `• 更新内容: ${v.message || '日常维护与功能迭代'}`;
                    alert(msg);
                })
                .catch(() => {
                    showToast('获取系统版本信息失败', 'warning');
                });
        }


        // Safe Fetch Helper: handles non-JSON / HTML 404 / 500 error gracefully
        async function safeFetchJson(url, options = {}) {
            const res = await fetch(url, options);

            const text = await res.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                if (!res.ok) {
                    throw new Error(`服务响应异常 (HTTP ${res.status}): ${res.status === 404 ? '请求的接口未找到，请确认后台服务已重启' : (res.statusText || '服务器内部错误')}`);
                }
                throw new Error('服务器返回了无法解析的非JSON数据');
            }
            if (!res.ok) {
                if (res.status === 401 && (data.need_login || (data.error && data.error.includes('登录')))) {
                    showToast('登录会话已失效，正在跳转登录页...', 'error');
                    setTimeout(() => {
                        window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
                    }, 800);
                    const err = new Error(data.error || '登录已失效');
                    err.data = data;
                    err.status = 401;
                    throw err;
                }
                const err = new Error(data.error || `请求失败 (HTTP ${res.status})`);
                err.data = data;
                err.status = res.status;

                throw err;
            }
            return data;
        }

        // BOM Hierarchy Numbering Calculator
        // 行号：按行顺序全局递增 (1, 2, 3...)
        // 序号：按层级树状编号，每个层级序号从10开始递增 (10, 20, 30...)
        function computeBomHierarchyNumbers(items, mode = 'step10') {
            if (!items || !items.length) return items || [];
            const parsedLevels = items.map(it => {
                let lvl = it.level_num;
                if (lvl === null || lvl === undefined || isNaN(parseInt(lvl))) {
                    const str = String(it.level_str || '');
                    if (str.includes('•')) {
                        lvl = (str.match(/•/g) || []).length;
                    } else if (str.includes('.')) {
                        const digits = str.match(/\d+/g);
                        lvl = digits ? parseInt(digits[0]) : 2;
                    } else {
                        lvl = 2;
                    }
                } else {
                    lvl = parseInt(lvl);
                }
                return Math.max(1, lvl);
            });

            const minLvl = Math.min(...parsedLevels);
            const baseOffset = minLvl > 1 ? minLvl - 1 : 0;

            let counters = [];
            items.forEach((it, idx) => {
                it.row_num = idx + 1;
                const effectiveLvl = Math.max(1, parsedLevels[idx] - baseOffset);
                while (counters.length < effectiveLvl) {
                    counters.push(0);
                }
                counters = counters.slice(0, effectiveLvl);
                counters[effectiveLvl - 1] += 1;
                if (mode === 'step10') {
                    it.seq_num = String(counters[effectiveLvl - 1] * 10);
                } else if (mode === 'dotted') {
                    it.seq_num = counters.join('.');
                } else {
                    it.seq_num = String(counters[effectiveLvl - 1]);
                }
            });
            return items;
        }


        function openModal(id) { document.getElementById(id).classList.add('show'); }
        function closeModal(id) {
            document.getElementById(id).classList.remove('show');
            if (id === 'pdfViewerModal') {
                pdfDoc = null;
                const canvas = document.getElementById('pdfViewerCanvas');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    canvas.style.display = 'none';
                }
            }
        }


        function escapeHtml(text) {
            if (!text) return '';
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // 纯净部套名称提取辅助工具
        function cleanSubsystemPartName(systemName, supplier = '', code = '', platform = '', model = '', defaultPartName = '') {
            const fallback = defaultPartName || '变桨系统';
            let s = (systemName || '').trim().replace(/^[_\s-]+|[_\s-]+$/g, '');
            if (!s) return fallback;

            // 兼容处理历史数据中包含 'SBOM_供应商' 的情况
            const m = s.match(/SBOM[_\s]*(.*?)$/i);
            if (m) {
                const tail = (m[1] || '').trim().replace(/^[_\s-]+|[_\s-]+$/g, '');
                s = s.substring(0, m.index).trim().replace(/[_\s-]+$/, '');
                if (tail) {
                    const parts = tail.split('_').map(p => p.trim()).filter(Boolean);
                    if (parts.length > 0) {
                        const extraParts = (supplier === parts[parts.length - 1]) ? parts.slice(0, -1) : parts;
                        if (extraParts.length > 0) {
                            s = `${s}_${extraParts.join('_')}`;
                        }
                    }
                }
            }

            const items = [code, platform, supplier, model];
            for (const item of items) {
                const str = (item || '').trim();
                if (str) {
                    if (s.startsWith(str)) {
                        s = s.substring(str.length).replace(/^[_\s-]+/, '');
                    }
                    if (s.endsWith(str)) {
                        s = s.substring(0, s.length - str.length).replace(/[_\s-]+$/, '');
                    }
                }
            }

            if (supplier) {
                const suppEsc = supplier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                s = s.replace(new RegExp(`_${suppEsc}$`, 'i'), '').replace(new RegExp(`^${suppEsc}_`, 'i'), '').replace(/^[_\s-]+|[_\s-]+$/g, '');
            }

            if (s.toUpperCase().endsWith('SBOM')) {
                s = s.substring(0, s.length - 4).replace(/[_\s-]+$/, '');
            }

            return s.replace(/^[_\s-]+|[_\s-]+$/g, '') || fallback;
        }

        // 统一格式化工程项目的展示名称: (平台/机型+供应商名称+部套名称+SBOM+型号)
        function formatProjectDisplayName(p) {
            if (!p) return '';

            const code = (p.code || '').trim();
            const platform = (p.platform || '').trim();
            const prefixPlatCode = code || platform || '';

            let supplier = (p.supplier || '').trim();
            const model = (p.model || p.root_model || '').trim();

            let rawSys = (p.system_name && p.system_name.trim()) 
                ? p.system_name.trim() 
                : ((p.name && p.name.trim() && p.name !== '风力发电机组') ? p.name.trim() : '');

            // 若 supplier 字段为空，尝试从历史名称如 变桨系统SBOM_电力电子 中解析出供应商
            if (!supplier && rawSys) {
                const m = rawSys.match(/SBOM[_\s]*(.*?)$/i);
                if (m && m[1]) {
                    const parts = m[1].trim().split('_').map(x => x.trim()).filter(Boolean);
                    if (parts.length > 0) {
                        supplier = parts[parts.length - 1];
                    }
                }
            }

            const category = (p.category || '').toLowerCase();
            let defaultPart = '变流器系统';
            if (category === 'pitch' || (!category && !rawSys.includes('变流'))) {
                defaultPart = '变桨系统';
            }
            const partName = cleanSubsystemPartName(rawSys, supplier, code, platform, model, defaultPart);
            const modelSuffix = model ? `_${model}` : '';

            return `${prefixPlatCode}${supplier}${partName}SBOM${modelSuffix}`;
        }
        // ==========================================
        function formatPipeMultilineHtml(val, isCentered = false) {
            if (val === null || val === undefined) return '';
            const rawStr = String(val).trim();
            if (!rawStr) return '';

            // Check if it contains | or ｜ or \n
            if (!/[|｜\n]/.test(rawStr)) {
                return `<div class="cell-text-ellipsis" title="${escapeHtml(rawStr)}">${escapeHtml(rawStr)}</div>`;
            }

            // Split into parts by | or ｜ or \n
            const lines = rawStr.split(/[|｜\n]/).map(s => s.trim()).filter(s => s.length > 0);
            if (lines.length <= 1) {
                const text = lines[0] || rawStr;
                return `<div class="cell-text-ellipsis" title="${escapeHtml(text)}">${escapeHtml(text)}</div>`;
            }

            const fullTitle = escapeHtml(lines.join('\n'));
            const itemsHtml = lines.map(line => 
                `<div class="cell-text-ellipsis" style="line-height: 1.35; ${isCentered ? 'text-align: center;' : ''}">${escapeHtml(line)}</div>`
            ).join('');

            return `<div class="cell-multiline-wrap" title="${fullTitle}">
                ${itemsHtml}
            </div>`;
        }

        function formatPipeMultilineHierarchy(val, prefixSymbol = '', indentPx = 0, collapsedHint = '') {
            if (val === null || val === undefined) val = '';
            const rawStr = String(val).trim();

            const hasPipe = /[|｜\n]/.test(rawStr);
            const lines = hasPipe ? rawStr.split(/[|｜\n]/).map(s => s.trim()).filter(s => s.length > 0) : [rawStr];
            const fullTitle = escapeHtml(lines.join('\n'));

            if (lines.length <= 1) {
                const text = lines[0] || '';
                if (prefixSymbol) {
                    return `<div style="padding-left: ${indentPx}px; display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0;" title="${fullTitle}">
                        <span style="color: #94a3b8; font-family: monospace; font-size: 12px; flex-shrink: 0;">${prefixSymbol}</span>
                        <span class="cell-text-ellipsis">${escapeHtml(text)}</span>
                        ${collapsedHint}
                    </div>`;
                } else {
                    return `<div class="cell-text-ellipsis" title="${fullTitle}">${escapeHtml(text)}${collapsedHint}</div>`;
                }
            }

            // Multiple lines
            const linesHtml = lines.map((l, i) => 
                `<span class="cell-text-ellipsis" style="line-height: 1.35;">${escapeHtml(l)}${i === 0 ? collapsedHint : ''}</span>`
            ).join('');

            if (prefixSymbol) {
                return `<div style="padding-left: ${indentPx}px; display: flex; align-items: flex-start; gap: 4px; width: 100%; min-width: 0;" title="${fullTitle}">
                    <span style="color: #94a3b8; font-family: monospace; font-size: 12px; flex-shrink: 0; line-height: 1.4;">${prefixSymbol}</span>
                    <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;">
                        ${linesHtml}
                    </div>
                </div>`;
            } else {
                return `<div style="display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 0;" title="${fullTitle}">
                    ${linesHtml}
                </div>`;
            }
        }

        function formatPipeMultilineMatNo(matNo, badgeHtml = '') {
            if (!matNo) return '';
            const rawStr = String(matNo).trim();
            const hasPipe = /[|｜\n]/.test(rawStr);
            const lines = hasPipe ? rawStr.split(/[|｜\n]/).map(s => s.trim()).filter(s => s.length > 0) : [rawStr];
            const fullTitle = escapeHtml(lines.join('\n'));

            if (lines.length <= 1) {
                return `<div style="display: flex; align-items: center; gap: 4px; overflow: hidden;" title="${fullTitle}">
                    <span class="cell-text-ellipsis" style="flex-shrink: 0; max-width: 100%; font-family: monospace; font-weight: bold;">${escapeHtml(lines[0] || '')}</span>
                    ${badgeHtml}
                </div>`;
            }

            return `<div style="display: flex; align-items: flex-start; gap: 4px; overflow: hidden;" title="${fullTitle}">
                <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;">
                    ${lines.map(l => `<span class="cell-text-ellipsis" style="line-height: 1.35; font-family: monospace; font-weight: bold;">${escapeHtml(l)}</span>`).join('')}
                </div>
                ${badgeHtml}
            </div>`;
        }


        // ==========================================
        // Authentication Management UI
        // ==========================================
        async function checkAuthStatus() {
            try {
                const res = await safeFetchJson('/api/auth/status');
                const btnLogout = document.getElementById('btnHeaderLogout');
                if (res && res.required) {
                    if (btnLogout) btnLogout.style.display = 'inline-flex';
                } else {
                    if (btnLogout) btnLogout.style.display = 'none';
                }
            } catch (e) {
                // Ignore
            }
        }

        async function handleUserLogout() {
            if (!confirm('确认退出当前系统登录状态？')) return;
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
            } catch (e) {}
            window.location.href = '/login';
        }

        // Auto-check auth status on page load
        document.addEventListener('DOMContentLoaded', checkAuthStatus);

        // ==========================================
        // Shared UI Helpers: Dropdowns, Search Badges, Hover Preview & Context Menu
        // ==========================================
        function closeAllUiDropdowns(exceptEl = null) {
            document.querySelectorAll('.ui-dropdown.open').forEach(dd => {
                if (dd !== exceptEl) dd.classList.remove('open');
            });
        }

        function toggleUiDropdown(btn, event) {
            if (event) event.stopPropagation();
            const wrap = btn ? btn.closest('.ui-dropdown') : null;
            if (!wrap) return;
            const willOpen = !wrap.classList.contains('open');
            closeAllUiDropdowns(wrap);
            if (willOpen) {
                wrap.classList.add('open');
            } else {
                wrap.classList.remove('open');
            }
        }

        function updateSearchBoxMeta(inputId, clearBtnId, badgeId, shownCount, totalCount) {
            const inp = document.getElementById(inputId);
            const clearBtn = document.getElementById(clearBtnId);
            const badge = document.getElementById(badgeId);
            const hasVal = !!(inp && inp.value && inp.value.trim().length > 0);

            if (clearBtn) {
                clearBtn.classList.toggle('visible', hasVal);
            }
            if (badge) {
                if (typeof totalCount === 'number' && totalCount >= 0) {
                    if (hasVal || (typeof shownCount === 'number' && shownCount !== totalCount)) {
                        badge.textContent = `${shownCount}/${totalCount}`;
                        badge.classList.add('is-filtered');
                    } else {
                        badge.textContent = `${totalCount} 条`;
                        badge.classList.remove('is-filtered');
                    }
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
        }

        // Hover Image Preview
        let _hoverImgTimer = null;
        function showHoverImgPreview(targetEl, src, caption = '') {
            if (!src || !targetEl) return;
            clearTimeout(_hoverImgTimer);
            _hoverImgTimer = setTimeout(() => {
                const box = document.getElementById('hoverImgPreviewBox');
                const img = document.getElementById('hoverImgPreviewImg');
                const cap = document.getElementById('hoverImgPreviewCaption');
                if (!box || !img) return;
                img.src = src;
                if (cap) {
                    cap.textContent = caption || '';
                    cap.style.display = caption ? 'block' : 'none';
                }
                box.style.display = 'block';

                const rect = targetEl.getBoundingClientRect();
                const boxW = 260;
                const boxH = 250;
                let left = rect.right + 10;
                if (left + boxW > window.innerWidth - 12) {
                    left = Math.max(12, rect.left - boxW - 10);
                }
                let top = rect.top - 20;
                if (top + boxH > window.innerHeight - 12) {
                    top = Math.max(12, window.innerHeight - boxH - 12);
                }
                if (top < 12) top = 12;
                box.style.left = `${left}px`;
                box.style.top = `${top}px`;
            }, 180);
        }

        function hideHoverImgPreview() {
            clearTimeout(_hoverImgTimer);
            const box = document.getElementById('hoverImgPreviewBox');
            if (box) box.style.display = 'none';
        }

        // Global Right-Click Context Menu
        function closeUiContextMenu() {
            const menu = document.getElementById('uiContextMenu');
            if (menu) {
                menu.classList.remove('show');
                menu.innerHTML = '';
            }
        }

        function openUiContextMenu(event, items) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            closeAllUiDropdowns();
            hideHoverImgPreview();

            const menu = document.getElementById('uiContextMenu');
            if (!menu || !Array.isArray(items) || items.length === 0) return;

            menu.innerHTML = '';
            items.forEach(item => {
                if (item.divider) {
                    const div = document.createElement('div');
                    div.className = 'ctx-menu-divider';
                    menu.appendChild(div);
                    return;
                }
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `ctx-menu-item${item.danger ? ' danger' : ''}`;
                if (item.disabled) btn.disabled = true;

                const labelSpan = document.createElement('span');
                labelSpan.textContent = item.label || '';
                btn.appendChild(labelSpan);

                if (item.shortcut) {
                    const scSpan = document.createElement('span');
                    scSpan.className = 'ctx-menu-shortcut';
                    scSpan.textContent = item.shortcut;
                    btn.appendChild(scSpan);
                }

                btn.onclick = (e) => {
                    e.stopPropagation();
                    closeUiContextMenu();
                    if (!item.disabled && typeof item.onClick === 'function') {
                        item.onClick();
                    }
                };
                menu.appendChild(btn);
            });

            menu.classList.add('show');
            const menuRect = menu.getBoundingClientRect();
            let x = event.clientX;
            let y = event.clientY;
            if (x + menuRect.width > window.innerWidth - 10) {
                x = Math.max(10, window.innerWidth - menuRect.width - 10);
            }
            if (y + menuRect.height > window.innerHeight - 10) {
                y = Math.max(10, window.innerHeight - menuRect.height - 10);
            }
            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.ui-dropdown')) {
                closeAllUiDropdowns();
            } else if (e.target.closest('.ui-dropdown-item')) {
                closeAllUiDropdowns();
            }
            if (!e.target.closest('#uiContextMenu')) {
                closeUiContextMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllUiDropdowns();
                closeUiContextMenu();
                hideHoverImgPreview();
            }
        });

        window.addEventListener('resize', () => {
            closeAllUiDropdowns();
            closeUiContextMenu();
            hideHoverImgPreview();
        });




