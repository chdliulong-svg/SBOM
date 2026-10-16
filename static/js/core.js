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

        function showToast(message, type = 'info') {
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
            toast.innerHTML = `<span style="display: inline-flex; align-items: center;">${icon}</span><span>${message}</span>`;
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-10px)';
                setTimeout(() => toast.remove(), 300);
            }, 3500);
        }

        function showVersionDetails() {
            fetch('/api/version')
                .then(r => r.json())
                .then(v => {
                    const msg = `【变桨系统Service BOM 版本详情】\n\n` +
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

        // 统一格式化工程项目的展示名称: 项目名称[平台名称][机型代号]
        function formatProjectDisplayName(p) {
            if (!p) return '';
            const projName = (p.system_name && p.system_name.trim()) 
                ? p.system_name.trim() 
                : ((p.name && p.name.trim() && p.name !== '风力发电机组') ? p.name.trim() : (p.code || '未命名项目'));
            
            let platStr = (p.platform && p.platform.trim()) ? p.platform.trim() : '';
            if (platStr) {
                platStr = (platStr.startsWith('[') && platStr.endsWith(']')) ? platStr : `[${platStr}]`;
            }
            
            let codeStr = (p.code && p.code.trim()) ? p.code.trim() : '';
            if (codeStr) {
                codeStr = (codeStr.startsWith('[') && codeStr.endsWith(']')) ? codeStr : `[${codeStr}]`;
            }
            
            return `${projName}${platStr}${codeStr}`;
        }

        // ==========================================
        // Pipe Separator Multiline Formatting Helpers
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



