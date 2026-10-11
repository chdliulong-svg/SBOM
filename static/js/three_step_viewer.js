/**
 * three_step_viewer.js
 * In-browser 3D CAD (.step / .stp / .iges / .igs) Viewer & Snapshot Generator.
 * Powered by OpenCASCADE WebAssembly (occt-import-js) and Three.js.
 * 
 * Features:
 * 1. 100% Client-side offline parsing & hardware-accelerated WebGL rendering.
 * 2. Instant auto-centering & isometric perspective framing.
 * 3. Interactive orbit controls (rotate, zoom, pan) with preset view angles.
 * 4. Crisp CAD feature edges (EdgesGeometry) and customizable background & material tone.
 * 5. High-resolution lossless PNG snapshot generation for BOM component photos.
 */

(function (window) {
    'use strict';

    let occtInstance = null;
    let occtLoadingPromise = null;

    let scene = null;
    let camera = null;
    let renderer = null;
    let controls = null;
    let currentModelGroup = null;
    let animFrameId = null;

    let modelBoundingSphere = null;
    let modelMaxDim = 10;
    let currentCallback = null;
    let currentSource = null;
    let currentFileName = '';

    // Cache of original mesh materials and geometries for theme toggling
    let meshRecords = [];

    const Step3dViewer = {
        /**
         * Check if a File or filename represents a supported 3D CAD model.
         */
        is3dFile(fileOrName) {
            if (!fileOrName) return false;
            const name = typeof fileOrName === 'string' ? fileOrName : (fileOrName.name || '');
            const lower = name.toLowerCase();
            return lower.endsWith('.step') || lower.endsWith('.stp') ||
                   lower.endsWith('.stpz') || lower.endsWith('.iges') ||
                   lower.endsWith('.igs');
        },

        /**
         * Initialize OpenCASCADE Wasm engine lazily
         */
        async getOcct() {
            if (occtInstance) return occtInstance;
            if (occtLoadingPromise) return occtLoadingPromise;

            if (typeof occtimportjs !== 'function') {
                throw new Error('occt-import-js 脚本尚未加载，请检查 /static/libs/3d/occt-import-js.js');
            }

            occtLoadingPromise = occtimportjs({
                locateFile: function (name) {
                    return '/static/libs/3d/' + name;
                }
            }).then(instance => {
                occtInstance = instance;
                return instance;
            });

            return occtLoadingPromise;
        },

        /**
         * Initialize Three.js scene, camera, lights, controls
         */
        initThree() {
            if (renderer) return;

            const canvas = document.getElementById('step3dCanvas');
            const wrapper = document.getElementById('step3dCanvasWrapper');
            if (!canvas || !wrapper) return;

            const width = wrapper.clientWidth || 760;
            const height = wrapper.clientHeight || 460;

            // 1. Scene
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0xffffff);

            // 2. Camera
            camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 2000);
            camera.position.set(20, 20, 20);

            // 3. Renderer with preserveDrawingBuffer for high-quality snapshot
            renderer = new THREE.WebGLRenderer({
                canvas: canvas,
                antialias: true,
                alpha: true,
                preserveDrawingBuffer: true
            });
            renderer.setSize(width, height);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.05;

            // 4. Lighting: Industrial CAD Studio Setup
            const ambient = new THREE.AmbientLight(0xffffff, 0.75);
            scene.add(ambient);

            const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
            keyLight.position.set(1.5, 2.5, 1.8);
            scene.add(keyLight);

            const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.45);
            fillLight.position.set(-1.8, -0.8, -1.5);
            scene.add(fillLight);

            const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
            rimLight.position.set(0, -2, 2);
            scene.add(rimLight);

            // 5. OrbitControls
            if (typeof THREE.OrbitControls === 'function') {
                controls = new THREE.OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;
                controls.dampingFactor = 0.08;
                controls.rotateSpeed = 0.8;
                controls.zoomSpeed = 1.0;
                controls.panSpeed = 0.8;
            }

            // Window resize handler
            window.addEventListener('resize', () => {
                Step3dViewer.resize();
            });

            // Start animation loop
            function animate() {
                animFrameId = requestAnimationFrame(animate);
                if (controls) controls.update();
                if (renderer && scene && camera) {
                    renderer.render(scene, camera);
                }
            }
            animate();
        },

        /**
         * Handle canvas wrapper resize
         */
        resize() {
            if (!renderer || !camera) return;
            const wrapper = document.getElementById('step3dCanvasWrapper');
            if (!wrapper) return;
            const width = wrapper.clientWidth;
            const height = wrapper.clientHeight;
            if (width > 0 && height > 0) {
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                renderer.setSize(width, height);
            }
        },

        /**
         * Trigger 3D CAD file selector dialog
         */
        triggerFilePicker(sourceType, extra) {
            currentSource = { type: sourceType, extra: extra };
            const input = document.getElementById('step3dFileInput');
            if (input) {
                input.value = '';
                input.click();
            }
        },

        /**
         * Handle file selected from #step3dFileInput
         */
        handleFileInput(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            if (!Step3dViewer.is3dFile(file)) {
                alert('请选择有效的 3D CAD 模型文件（.stp / .step / .iges / .igs）！');
                return;
            }

            const src = currentSource || {};
            if (src.type === 'bomModal') {
                Step3dViewer.open(file, {
                    onConfirm: (snapshotFile) => {
                        if (typeof window.applyModalImgFile === 'function') {
                            window.applyModalImgFile(snapshotFile, '已从3D模型生成截图');
                        }
                    }
                });
            } else if (src.type === 'masterModal') {
                Step3dViewer.open(file, {
                    onConfirm: (snapshotFile) => {
                        if (typeof window.handleMm3dSnapshotReady === 'function') {
                            window.handleMm3dSnapshotReady(snapshotFile, file.name);
                        }
                    }
                });
            } else if (src.type === 'singleRow') {
                const targetMatNo = src.extra;
                Step3dViewer.open(file, {
                    onConfirm: async (snapshotFile) => {
                        await Step3dViewer.uploadSnapshotForMaterial(snapshotFile, targetMatNo);
                    }
                });
            } else {
                // Generic open
                Step3dViewer.open(file);
            }
        },

        /**
         * Open 3D viewer modal and load the CAD file
         */
        async open(file, options) {
            options = options || {};
            currentCallback = options.onConfirm || null;
            currentFileName = file.name || 'model.step';

            // Show modal
            const modal = document.getElementById('step3dModal');
            if (modal) {
                modal.classList.add('show');
                modal.style.display = 'flex';
            }

            // Update title badge
            const badge = document.getElementById('step3dFileBadge');
            if (badge) {
                const sizeKb = (file.size / 1024).toFixed(1);
                badge.textContent = `${currentFileName} (${sizeKb} KB)`;
            }

            // Show loading spinner
            const loading = document.getElementById('step3dLoading');
            const loadingText = document.getElementById('step3dLoadingText');
            if (loading) loading.style.display = 'flex';
            if (loadingText) loadingText.textContent = '正在初始化 OpenCASCADE 3D 引擎...';

            // Initialize Three.js if needed
            Step3dViewer.initThree();

            // Resize canvas to match layout
            setTimeout(() => {
                Step3dViewer.resize();
            }, 60);

            try {
                // 1. Load Wasm engine
                const occt = await Step3dViewer.getOcct();
                if (loadingText) loadingText.textContent = '正在解析 CAD 几何曲面并进行离散化三角剖分 (Tessellation)...';

                // 2. Read file as ArrayBuffer
                const arrayBuffer = await file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);

                // 3. Parse with OpenCASCADE Wasm
                let result = null;
                const lowerName = currentFileName.toLowerCase();
                if (lowerName.endsWith('.iges') || lowerName.endsWith('.igs')) {
                    result = occt.ReadIgesFile(uint8Array, null);
                } else {
                    result = occt.ReadStepFile(uint8Array, null);
                }

                if (!result || !result.success || !result.meshes || result.meshes.length === 0) {
                    throw new Error('CAD 模型解析失败或未包含可显示的实体网格，请确认 STEP/IGES 文件完整性');
                }

                if (loadingText) loadingText.textContent = '正在生成三维装配体与工程轮廓线...';

                // 4. Build Three.js Geometry
                Step3dViewer.buildModelGroup(result.meshes);

                // 5. Hide loading
                if (loading) loading.style.display = 'none';

            } catch (err) {
                console.error('3D CAD loading error:', err);
                if (loadingText) {
                    loadingText.innerHTML = `<span style="color: #dc2626;">解析失败：${err.message || '未知错误'}</span>`;
                }
                setTimeout(() => {
                    alert(`3D 模型解析失败: ${err.message || '文件损坏或不支持'}`);
                    Step3dViewer.closeModal();
                }, 1000);
            }
        },

        /**
         * Construct Three.js Group from OCCT meshes
         */
        buildModelGroup(meshes) {
            // Clean previous model
            Step3dViewer.clearModel();

            currentModelGroup = new THREE.Group();
            meshRecords = [];

            let totalTriangles = 0;

            for (const meshData of meshes) {
                if (!meshData.attributes || !meshData.attributes.position) continue;

                const geom = new THREE.BufferGeometry();
                const posArray = new Float32Array(meshData.attributes.position.array);
                geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

                if (meshData.attributes.normal && meshData.attributes.normal.array.length > 0) {
                    const normArray = new Float32Array(meshData.attributes.normal.array);
                    geom.setAttribute('normal', new THREE.BufferAttribute(normArray, 3));
                } else {
                    geom.computeVertexNormals();
                }

                if (meshData.index && meshData.index.array.length > 0) {
                    const indexArray = new Uint32Array(meshData.index.array);
                    geom.setIndex(new THREE.BufferAttribute(indexArray, 1));
                    totalTriangles += indexArray.length / 3;
                } else {
                    totalTriangles += posArray.length / 9;
                }

                // Native color from CAD model or default silver-blue
                let baseColor = new THREE.Color(0x94a3b8);
                let hasNativeColor = false;
                if (meshData.color && meshData.color.length >= 3) {
                    baseColor = new THREE.Color(meshData.color[0], meshData.color[1], meshData.color[2]);
                    hasNativeColor = true;
                }

                const mat = new THREE.MeshStandardMaterial({
                    color: baseColor,
                    roughness: 0.38,
                    metalness: 0.22,
                    side: THREE.DoubleSide
                });

                const mesh = new THREE.Mesh(geom, mat);
                currentModelGroup.add(mesh);

                // Feature edge lines (Sharp boundary / crease lines)
                const edgesGeom = new THREE.EdgesGeometry(geom, 26);
                const edgesMat = new THREE.LineBasicMaterial({
                    color: 0x334155,
                    linewidth: 1
                });
                const edgesLine = new THREE.LineSegments(edgesGeom, edgesMat);
                edgesLine.name = 'featureEdgeLine';
                currentModelGroup.add(edgesLine);

                meshRecords.push({
                    mesh: mesh,
                    edges: edgesLine,
                    nativeColor: baseColor,
                    hasNativeColor: hasNativeColor
                });
            }

            // Compute bounding box and center
            const box = new THREE.Box3().setFromObject(currentModelGroup);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Center model at origin
            currentModelGroup.position.set(-center.x, -center.y, -center.z);

            const rootWrapper = new THREE.Group();
            rootWrapper.name = 'rootWrapper';
            rootWrapper.add(currentModelGroup);
            scene.add(rootWrapper);

            // Compute max dimension
            modelMaxDim = Math.max(size.x, size.y, size.z);
            if (modelMaxDim < 0.001) modelMaxDim = 1;

            // Frame camera to fit model
            Step3dViewer.fitCamera(modelMaxDim);

            // Update stats
            const stats = document.getElementById('step3dStatsText');
            if (stats) {
                stats.textContent = `实体数: ${meshes.length} · 三角面: ${Math.round(totalTriangles).toLocaleString()}`;
            }

            // Sync edge checkbox
            const edgeToggle = document.getElementById('step3dEdgesToggle');
            if (edgeToggle) {
                Step3dViewer.toggleEdges(edgeToggle.checked);
            }

            // Sync background
            const bgSelect = document.getElementById('step3dBgSelect');
            if (bgSelect) {
                Step3dViewer.setBackground(bgSelect.value);
            }

            // Sync theme
            const themeSelect = document.getElementById('step3dColorSelect');
            if (themeSelect) {
                Step3dViewer.setColorTheme(themeSelect.value);
            }
        },

        /**
         * Frame camera and center on model
         */
        fitCamera(maxDim) {
            if (!camera || !controls) return;

            const fov = camera.fov * (Math.PI / 180);
            let distance = (maxDim / 2) / Math.tan(fov / 2) * 1.55;
            if (distance < 0.1) distance = 1;

            camera.near = maxDim / 100;
            camera.far = maxDim * 100;
            camera.updateProjectionMatrix();

            // Default: Standard Isometric View
            Step3dViewer.setView('iso', distance);
        },

        /**
         * Set camera angle presets
         */
        setView(preset, optDist) {
            if (!camera || !controls) return;

            const dist = optDist || (modelMaxDim * 2.2);
            controls.target.set(0, 0, 0);

            switch (preset) {
                case 'iso': // Standard Engineering Isometric View
                    camera.position.set(dist * 0.72, dist * 0.58, dist * 0.72);
                    break;
                case 'front': // Front
                    camera.position.set(0, 0, dist * 1.15);
                    break;
                case 'top': // Top
                    camera.position.set(0, dist * 1.15, 0.0001);
                    break;
                case 'right': // Right side
                    camera.position.set(dist * 1.15, 0, 0);
                    break;
                case 'left': // Left side
                    camera.position.set(-dist * 1.15, 0, 0);
                    break;
                default:
                    camera.position.set(dist * 0.72, dist * 0.58, dist * 0.72);
            }

            camera.lookAt(0, 0, 0);
            controls.update();
        },

        /**
         * Reset view to isometric
         */
        resetCamera() {
            Step3dViewer.setView('iso');
        },

        /**
         * Toggle feature edges
         */
        toggleEdges(visible) {
            meshRecords.forEach(rec => {
                if (rec.edges) rec.edges.visible = !!visible;
            });
        },

        /**
         * Set canvas background
         */
        setBackground(bgType) {
            if (!renderer || !scene) return;
            if (bgType === 'white') {
                scene.background = new THREE.Color(0xffffff);
                renderer.setClearColor(0xffffff, 1.0);
            } else if (bgType === 'studio') {
                scene.background = new THREE.Color(0xf8fafc);
                renderer.setClearColor(0xf8fafc, 1.0);
            } else if (bgType === 'transparent') {
                scene.background = null;
                renderer.setClearColor(0x000000, 0.0);
            }
        },

        /**
         * Change model material color theme
         */
        setColorTheme(theme) {
            meshRecords.forEach(rec => {
                if (!rec.mesh || !rec.mesh.material) return;
                const mat = rec.mesh.material;

                if (theme === 'default') {
                    mat.color.copy(rec.nativeColor);
                    mat.roughness = 0.38;
                    mat.metalness = 0.22;
                } else if (theme === 'wind_white') {
                    mat.color.setHex(0xf8fafc);
                    mat.roughness = 0.45;
                    mat.metalness = 0.12;
                } else if (theme === 'cad_blue') {
                    mat.color.setHex(0x3b82f6);
                    mat.roughness = 0.35;
                    mat.metalness = 0.25;
                } else if (theme === 'brass') {
                    mat.color.setHex(0xd97706);
                    mat.roughness = 0.32;
                    mat.metalness = 0.65;
                }
            });
        },

        /**
         * Confirm snapshot, generate high-res PNG, and trigger callback
         */
        confirmSnapshot() {
            if (!renderer || !scene || !camera) {
                alert('3D 视口尚未就绪');
                return;
            }

            // Force high-quality synchronous render
            renderer.render(scene, camera);

            const canvas = renderer.domElement;
            canvas.toBlob((blob) => {
                if (!blob) {
                    alert('生成截图失败，请重试');
                    return;
                }

                const baseName = currentFileName.replace(/\.[^/.]+$/, '');
                const fileName = `${baseName}_3d.png`;
                const snapshotFile = new File([blob], fileName, { type: 'image/png' });

                if (typeof currentCallback === 'function') {
                    currentCallback(snapshotFile);
                }

                Step3dViewer.closeModal();

                if (typeof window.showToast === 'function') {
                    window.showToast('✓ 3D模型截图已成功生成！');
                }
            }, 'image/png', 0.95);
        },

        /**
         * Helper to upload snapshot directly for single BOM row
         */
        async uploadSnapshotForMaterial(snapshotFile, matNo) {
            if (!matNo) return;
            const formData = new FormData();
            formData.append('file', snapshotFile);
            formData.append('material_no', matNo);

            try {
                const res = await fetch('/api/upload/image', {
                    method: 'POST',
                    body: formData
                }).then(r => r.json());

                if (res.success) {
                    if (typeof window.loadBomItems === 'function' && window.currentSubsystemId) {
                        window.loadBomItems(window.currentSubsystemId);
                    }
                    if (typeof window.loadMasterMaterials === 'function') {
                        window.loadMasterMaterials();
                    }
                    if (typeof window.showToast === 'function') {
                        window.showToast(`✓ 已成功为物料【${matNo}】更新 3D 截图实物照片`);
                    }
                } else {
                    alert(res.error || '上传图片失败');
                }
            } catch (err) {
                console.error('Failed to upload snapshot:', err);
                alert('上传物料图片网络异常');
            }
        },

        /**
         * Clean up 3D geometries and materials
         */
        clearModel() {
            if (!scene) return;
            const oldWrapper = scene.getObjectByName('rootWrapper');
            if (oldWrapper) {
                oldWrapper.traverse((child) => {
                    if (child.isMesh || child.isLineSegments) {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                            else child.material.dispose();
                        }
                    }
                });
                scene.remove(oldWrapper);
            }
            meshRecords = [];
            currentModelGroup = null;
        },

        /**
         * Close 3D snapshot modal
         */
        closeModal() {
            const modal = document.getElementById('step3dModal');
            if (modal) {
                modal.classList.remove('show');
                modal.style.display = 'none';
            }
            Step3dViewer.clearModel();
            currentCallback = null;
            currentSource = null;
        }
    };

    window.Step3dViewer = Step3dViewer;

})(window);
