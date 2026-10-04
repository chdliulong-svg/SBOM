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
                throw new Error(data.error || `请求失败 (HTTP ${res.status})`);
            }
            return data;
        }

        // BOM Hierarchy Numbering Calculator
        // 行号：按行顺序全局递增 (1, 2, 3...)
        // 序号：按层级树状点分编号 (1, 1.1, 1.2, 1.2.1, 2, 2.1...)
        function computeBomHierarchyNumbers(items, mode = 'dotted') {
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
                it.seq_num = mode === 'dotted' ? counters.join('.') : String(counters[effectiveLvl - 1]);
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


