// ==========================================
// Service BOM - Offline PDF.js Viewer Engine
// ==========================================

        // --- Online PDF Preview Function (Pure HTML5 Canvas via PDF.js) ---
        let pdfDoc = null;
        let pdfPageNum = 1;
        let pdfPageRendering = false;
        let pdfPageNumPending = null;
        let pdfScale = 1.25;

        let currentPdfUrl = '';
        let currentPdfMatNo = '';
        let currentPdfMatName = '';

        function previewManualOnline(url, matNo, matName) {
            currentPdfUrl = url || '';
            currentPdfMatNo = matNo || '';
            currentPdfMatName = matName || '';

            const title = document.getElementById('pdfViewerTitle');
            const sub = document.getElementById('pdfViewerSubtitle');
            const downloadBtn = document.getElementById('pdfDownloadBtn') || document.getElementById('pdfOpenNewTabBtn');

            title.textContent = `技术手册在线预览 - ${matNo} ${matName ? '(' + matName + ')' : ''}`;
            sub.textContent = `技术文档阅览 · ${matNo}.pdf`;

            const safeMatNo = (matNo || 'document').replace(/[\\/:*?"<>|]/g, '_');
            const safeMatName = (matName || '').replace(/[\\/:*?"<>|]/g, '_').trim();
            const downloadFileName = safeMatName ? `${safeMatNo}_${safeMatName}_技术手册.pdf` : `${safeMatNo}_技术手册.pdf`;

            if (downloadBtn) {
                if (url.startsWith('blob:')) {
                    downloadBtn.href = url;
                } else {
                    const sep = url.includes('?') ? '&' : '?';
                    downloadBtn.href = `${url}${sep}download=1&filename=${encodeURIComponent(downloadFileName)}`;
                }
                downloadBtn.setAttribute('download', downloadFileName);
            }

            openModal('pdfViewerModal');

            pdfPageNum = 1;
            loadPdfDocument(url);
        }

        function downloadCurrentPdf(event) {
            if (!currentPdfUrl) return;
            const safeMatNo = (currentPdfMatNo || 'document').replace(/[\\/:*?"<>|]/g, '_');
            const safeMatName = (currentPdfMatName || '').replace(/[\\/:*?"<>|]/g, '_').trim();
            const downloadFileName = safeMatName ? `${safeMatNo}_${safeMatName}_技术手册.pdf` : `${safeMatNo}_技术手册.pdf`;

            if (currentPdfUrl.startsWith('blob:')) {
                const a = document.createElement('a');
                a.href = currentPdfUrl;
                a.download = downloadFileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                if (event) event.preventDefault();
                return;
            }

            const sep = currentPdfUrl.includes('?') ? '&' : '?';
            const downloadUrl = `${currentPdfUrl}${sep}download=1&filename=${encodeURIComponent(downloadFileName)}`;

            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = downloadFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            if (event) event.preventDefault();
        }

        function loadPdfDocument(url) {
            const spinner = document.getElementById('pdfLoadingSpinner');
            const canvas = document.getElementById('pdfViewerCanvas');
            if (spinner) {
                spinner.style.display = 'flex';
                spinner.innerHTML = `<div class="spinner-border" style="width: 26px; height: 26px; border: 3px solid #cbd5e1; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 8px;"></div><div>正在加载技术手册，请稍候...</div>`;
            }
            if (canvas) canvas.style.display = 'none';

            pdfDoc = null;
            if (window.pdfjsLib) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/pdfjs/pdf.worker.min.js';
                pdfjsLib.getDocument(url).promise.then(function(doc) {
                    pdfDoc = doc;
                    document.getElementById('pdfPageCountSpan').textContent = doc.numPages;
                    document.getElementById('pdfPageNumInput').max = doc.numPages;
                    renderPdfPage(pdfPageNum);
                }).catch(function(err) {
                    console.error('Error loading PDF via PDF.js:', err);
                    if (spinner) {
                        const safeMatNo = (currentPdfMatNo || 'document').replace(/[\\/:*?"<>|]/g, '_');
                        const safeMatName = (currentPdfMatName || '').replace(/[\\/:*?"<>|]/g, '_').trim();
                        const downloadFileName = safeMatName ? `${safeMatNo}_${safeMatName}_技术手册.pdf` : `${safeMatNo}_技术手册.pdf`;
                        const sep = url.includes('?') ? '&' : '?';
                        const downloadUrl = url.startsWith('blob:') ? url : `${url}${sep}download=1&filename=${encodeURIComponent(downloadFileName)}`;
                        spinner.innerHTML = `
                            <div style="color: #fca5a5; font-size: 14px;">预览加载受限: ${escapeHtml(err.message || '加载超时')}</div>
                            <div style="margin-top: 10px;">
                                <a href="${downloadUrl}" download="${downloadFileName}" onclick="downloadCurrentPdf(event)" class="btn btn-primary btn-sm">下载到本地</a>
                            </div>
                        `;
                    }
                });
            } else {
                if (spinner) {
                    const safeMatNo = (currentPdfMatNo || 'document').replace(/[\\/:*?"<>|]/g, '_');
                    const safeMatName = (currentPdfMatName || '').replace(/[\\/:*?"<>|]/g, '_').trim();
                    const downloadFileName = safeMatName ? `${safeMatNo}_${safeMatName}_技术手册.pdf` : `${safeMatNo}_技术手册.pdf`;
                    const sep = url.includes('?') ? '&' : '?';
                    const downloadUrl = url.startsWith('blob:') ? url : `${url}${sep}download=1&filename=${encodeURIComponent(downloadFileName)}`;
                    spinner.innerHTML = `
                        <div>PDF 渲染组件正在初始化，您可直接下载：</div>
                        <div style="margin-top: 10px;">
                            <a href="${downloadUrl}" download="${downloadFileName}" onclick="downloadCurrentPdf(event)" class="btn btn-primary btn-sm">下载到本地</a>
                        </div>
                    `;
                }
            }
        }

        function renderPdfPage(num) {
            if (!pdfDoc) return;
            pdfPageRendering = true;

            pdfDoc.getPage(num).then(function(page) {
                const canvas = document.getElementById('pdfViewerCanvas');
                const ctx = canvas.getContext('2d');

                const outputScale = window.devicePixelRatio || 1;
                const viewport = page.getViewport({ scale: pdfScale });

                canvas.width = Math.floor(viewport.width * outputScale);
                canvas.height = Math.floor(viewport.height * outputScale);
                canvas.style.width = Math.floor(viewport.width) + "px";
                canvas.style.height = Math.floor(viewport.height) + "px";

                const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

                const renderContext = {
                    canvasContext: ctx,
                    transform: transform,
                    viewport: viewport
                };

                const renderTask = page.render(renderContext);
                renderTask.promise.then(function() {
                    pdfPageRendering = false;
                    const spinner = document.getElementById('pdfLoadingSpinner');
                    if (spinner) spinner.style.display = 'none';
                    canvas.style.display = 'block';

                    if (pdfPageNumPending !== null) {
                        renderPdfPage(pdfPageNumPending);
                        pdfPageNumPending = null;
                    }
                });
            });

            document.getElementById('pdfPageNumInput').value = num;
            document.getElementById('pdfZoomSpan').textContent = `${Math.round(pdfScale * 100)}%`;

            document.getElementById('pdfPrevPageBtn').disabled = (num <= 1);
            document.getElementById('pdfNextPageBtn').disabled = (num >= (pdfDoc ? pdfDoc.numPages : 1));
        }

        function queueRenderPdfPage(num) {
            if (pdfPageRendering) {
                pdfPageNumPending = num;
            } else {
                renderPdfPage(num);
            }
        }

        function onPdfPrevPage() {
            if (pdfPageNum <= 1) return;
            pdfPageNum--;
            queueRenderPdfPage(pdfPageNum);
            document.getElementById('pdfViewerScrollContainer').scrollTop = 0;
        }

        function onPdfNextPage() {
            if (!pdfDoc || pdfPageNum >= pdfDoc.numPages) return;
            pdfPageNum++;
            queueRenderPdfPage(pdfPageNum);
            document.getElementById('pdfViewerScrollContainer').scrollTop = 0;
        }

        function onPdfPageNumChange(val) {
            if (!pdfDoc) return;
            let num = parseInt(val, 10);
            if (isNaN(num)) num = 1;
            if (num < 1) num = 1;
            if (num > pdfDoc.numPages) num = pdfDoc.numPages;
            pdfPageNum = num;
            queueRenderPdfPage(pdfPageNum);
        }

        function onPdfZoomIn() {
            if (pdfScale >= 3.0) return;
            pdfScale = Math.min(3.0, pdfScale + 0.15);
            renderPdfPage(pdfPageNum);
        }

        function onPdfZoomOut() {
            if (pdfScale <= 0.4) return;
            pdfScale = Math.max(0.4, pdfScale - 0.15);
            renderPdfPage(pdfPageNum);
        }

        function onPdfFitWidth() {
            if (!pdfDoc) return;
            pdfDoc.getPage(pdfPageNum).then(function(page) {
                const container = document.getElementById('pdfViewerScrollContainer');
                const containerWidth = container.clientWidth - 60;
                const unscaledViewport = page.getViewport({ scale: 1.0 });
                pdfScale = Math.max(0.4, containerWidth / unscaledViewport.width);
                renderPdfPage(pdfPageNum);
            });
        }

        function onPdfFitPage() {
            if (!pdfDoc) return;
            pdfDoc.getPage(pdfPageNum).then(function(page) {
                const container = document.getElementById('pdfViewerScrollContainer');
                const containerHeight = container.clientHeight - 80;
                const unscaledViewport = page.getViewport({ scale: 1.0 });
                pdfScale = Math.max(0.4, containerHeight / unscaledViewport.height);
                renderPdfPage(pdfPageNum);
            });
        }

        function handlePdfWheel(e) {
            if (e.ctrlKey) {
                e.preventDefault();
                if (e.deltaY < 0) onPdfZoomIn();
                else onPdfZoomOut();
            }
        }

        // Keyboard navigation when PDF modal is open
        document.addEventListener('keydown', function(e) {
            const modal = document.getElementById('pdfViewerModal');
            if (!modal || !modal.classList.contains('show')) return;

            if (e.target && e.target.tagName === 'INPUT') return;

            if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
                onPdfPrevPage();
                e.preventDefault();
            } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
                onPdfNextPage();
                e.preventDefault();
            } else if (e.key === '+' || e.key === '=') {
                onPdfZoomIn();
                e.preventDefault();
            } else if (e.key === '-') {
                onPdfZoomOut();
                e.preventDefault();
            }
        });


