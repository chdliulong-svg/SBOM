// ==========================================
// Service BOM - Application Initialization Entrypoint
// ==========================================

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            const urlParams = new URLSearchParams(window.location.search);
            const initProjId = urlParams.get('proj') || urlParams.get('p') || null;
            loadProjects(initProjId ? parseInt(initProjId) : null);
            // 性能优化：首屏优先加载当前工程关键BOM，物料主库在空闲时静默预加载
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => loadMasterMaterials(), { timeout: 2000 });
            } else {
                setTimeout(() => loadMasterMaterials(), 1000);
            }
            initTableColumnResizing('bomTable');


            initTableColumnResizing('masterTable');
            initModalImgDragAndDrop();
            if (typeof initMmAttachmentListeners === 'function') initMmAttachmentListeners();

            // Click outside fuzzy dropdown to close it
            document.addEventListener('click', (e) => {
                if (!e.target.closest('#masterSelectGroup')) {
                    const el = document.getElementById('fuzzyDropdownResults');
                    if (el) el.style.display = 'none';
                }
                if (!e.target.closest('#bm-desc') && !e.target.closest('#descFuzzyDropdown')) {
                    const el = document.getElementById('descFuzzyDropdown');
                    if (el) el.style.display = 'none';
                }
                if (!e.target.closest('#hier-child-search') && !e.target.closest('#hierFuzzyDropdown')) {
                    const el = document.getElementById('hierFuzzyDropdown');
                    if (el) el.style.display = 'none';
                }
            });

            // Global Escape key listener to dismiss open modals
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const openModals = document.querySelectorAll('.modal-mask.show');
                    if (openModals.length > 0) {
                        const topModal = openModals[openModals.length - 1];
                        closeModal(topModal.id);
                    }
                }
            });

            // Master Hub Enter key listeners
            const masterSearchInput = document.getElementById('masterSearch');
            if (masterSearchInput) {
                masterSearchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') loadMasterMaterials();
                });
            }

            ['hier-child-search', 'hier-qty', 'hier-unit', 'hier-drawing'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') submitSaveHierarchyChild();
                    });
                }
            });

            ['mm-mat-no', 'mm-name', 'mm-spec-model', 'mm-manufacturer', 'mm-unit', 'mm-substitute'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') submitMasterItem();
                    });
                }
            });

            // Real-time material de-duplication check
            ['mm-name', 'mm-spec-model'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('input', () => {
                        if (typeof checkInputMaterialDuplicate === 'function') {
                            checkInputMaterialDuplicate();
                        }
                    });
                }
            });

            // Power-User Keyboard Shortcuts
            document.addEventListener('keydown', (e) => {
                const targetTag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
                const isTyping = (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT');

                // 1. Ctrl + S: Quick Save Project
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    if (typeof saveProjectCover === 'function' && typeof currentProjectId !== 'undefined' && currentProjectId) {
                        saveProjectCover();
                    }
                    return;
                }

                // If currently typing in an input/textarea, do not intercept table row operations
                if (isTyping) return;

                // 2. Alt + ArrowUp: Move selected row up
                if (e.altKey && e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (typeof moveSelectedRow === 'function') {
                        moveSelectedRow('up');
                    }
                    return;
                }

                // 3. Alt + ArrowDown: Move selected row down
                if (e.altKey && e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (typeof moveSelectedRow === 'function') {
                        moveSelectedRow('down');
                    }
                    return;
                }

                // 4. Ctrl + Enter or Insert: Quick Insert Material Row
                if (e.key === 'Insert' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
                    e.preventDefault();
                    if (typeof openAddBomModal === 'function') {
                        openAddBomModal();
                    }
                    return;
                }

                // 5. Delete: Delete selected row(s)
                if (e.key === 'Delete') {
                    if (typeof selectedRowIds !== 'undefined' && selectedRowIds && selectedRowIds.size > 0) {
                        e.preventDefault();
                        if (typeof deleteSelectedRow === 'function') {
                            deleteSelectedRow();
                        }
                    }
                    return;
                }

                // 6. Ctrl + C: Copy selected BOM row(s) (supports multi-select, cross-sheet and cross-project)
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                    if (typeof selectedRowIds !== 'undefined' && selectedRowIds && selectedRowIds.size > 0) {
                        const selText = window.getSelection ? window.getSelection().toString() : '';
                        if (!selText) {
                            e.preventDefault();
                            if (typeof copySelectedBomRows === 'function') {
                                copySelectedBomRows();
                            }
                        }
                    }
                    return;
                }

                // 7. Ctrl + V: Paste BOM row(s) (cross-sheet and cross-project)
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                    const openModal = document.querySelector('.modal-mask.show');
                    if (!openModal) {
                        if (typeof pasteBomRows === 'function') {
                            e.preventDefault();
                            pasteBomRows();
                        }
                    }
                    return;
                }
            });
        });

        // Page initialization
        document.addEventListener('DOMContentLoaded', () => {

            const qMaster = new URLSearchParams(window.location.search).get('open_master');
            if (qMaster) {
                setTimeout(() => { if (typeof openMasterModal === 'function') openMasterModal(); }, 800);
            }

            const qHier = new URLSearchParams(window.location.search).get('open_hier');
            if (qHier) openMasterHierarchyModal(qHier);
            const qEdit = new URLSearchParams(window.location.search).get('open_edit');
            if (qEdit) {
                setTimeout(() => {
                    if (currentBomItems && currentBomItems.length > 0) openEditBomModal(0);
                    else openAddBomModal();
                }, 800);
            }
            const qAdd = new URLSearchParams(window.location.search).get('open_add');
            if (qAdd) {
                setTimeout(() => { openAddBomModal(); }, 800);
            }
        });

