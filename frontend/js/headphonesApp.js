/**
 * HeadphonesApp - Main application controller for the Virtual Headphones Try-On.
 * Orchestrates CameraManager, FaceTracker, HeadphonesRenderer, and HeadphonesAPI.
 */
class HeadphonesApp {
    constructor() {
        /** @type {CameraManager} */
        this.cameraManager = new CameraManager();
        /** @type {FaceTracker} */
        this.faceTracker = new FaceTracker();
        /** @type {HeadphonesRenderer} */
        this.headphonesRenderer = new HeadphonesRenderer();
        /** @type {HeadphonesAPI} */
        this.headphonesAPI = new HeadphonesAPI();

        /** @type {boolean} */
        this.isRunning = false;
        /** @type {number|null} */
        this.currentModelId = null;
        /** @type {Array} */
        this.modelList = [];
        /** @type {Array} */
        this.originalModelList = [];
        /** @type {string|null} */
        this.selectedCategory = null; // 'headphone' or 'earbud'
        /** @type {number|null} */
        this.animationFrameId = null;

        // Pagination
        this.currentPage = 1;
        this.itemsPerPage = 5;
        this.shortlistImageDataUrl = null;

        // Performance tracking
        /** @type {number} */
        this.fps = 0;
        /** @type {number} */
        this.frameCount = 0;
        /** @type {number} */
        this.lastFpsUpdate = 0;

        /** @type {boolean} */
        this._wasFaceDetected = false;
        /** @type {number} */
        this._faceLostTime = 0;
    }

    /**
     * Wait for global libraries (MediaPipe and Three.js) to load.
     */
    _waitForLib(flagName, eventName, isReady) {
        if (window[flagName] || isReady()) return Promise.resolve();
        return new Promise((resolve) => {
            window.addEventListener(eventName, resolve, { once: true });
            const t = setInterval(() => {
                if (isReady()) { clearInterval(t); resolve(); }
            }, 50);
        });
    }

    /**
     * Initialize the entire application.
     */
    async init() {
        try {
            const videoEl = document.getElementById('camera-video');
            const canvasEl = document.getElementById('headphones-canvas');

            if (!videoEl) throw new Error('Video element #camera-video not found.');
            if (!canvasEl) throw new Error('Canvas element #headphones-canvas not found.');

            this._showLoading('Configuring acoustic mirrors...');

            // Run camera, MediaPipe, Three.js, and catalog loads in parallel
            await Promise.all([
                this.cameraManager.init(videoEl).then(() => {
                    console.log(`[App] Camera ready: ${this.cameraManager.getVideoDimensions().width}x${this.cameraManager.getVideoDimensions().height}`);
                }),

                this._waitForLib(
                    '__mediapipeReady',
                    'mediapipe-ready',
                    () => typeof window.FaceLandmarker !== 'undefined'
                ).then(() => this.faceTracker.init()).then(() => {
                    console.log('[App] Face tracker ready.');
                }),

                this._waitForLib(
                    '__threejsReady',
                    'threejs-ready',
                    () => typeof window.THREE !== 'undefined' && typeof window.THREE.GLTFLoader !== 'undefined'
                ).then(() => {
                    console.log('[App] Three.js ready.');
                }),

                this._loadCatalog().then(() => {
                    console.log(`[App] Catalog loaded: ${this.modelList.length} items.`);
                })
            ]);

            // Initialize Three.js WebGL renderer
            const { width: videoWidth, height: videoHeight } = this.cameraManager.getVideoDimensions();
            await new Promise(r => requestAnimationFrame(r));
            this.headphonesRenderer.init(canvasEl, videoWidth, videoHeight);
            
            // Set initial category filter (default: headphone)
            this.headphonesRenderer.setCategory('headphone');

            // Event listeners
            this._setupEventListeners();

            this._hideLoading();
            this.isRunning = true;
            this.lastFpsUpdate = performance.now();
            this._renderLoop();

            // Select first model if catalog is not empty, otherwise default to procedural fallback
            if (this.modelList.length > 0) {
                await this.selectModel(this.modelList[0].id);
            } else {
                this.headphonesRenderer._loadDefaultProceduralModel();
            }

            console.log('[App] Virtual Headphones Try-On initialized successfully!');
        } catch (error) {
            console.error('[App] Initialization failed:', error);
            this._hideLoading();
            this._showError(error.message);
        }
    }

    /**
     * Main animation/render loop.
     */
    _renderLoop() {
        if (!this.isRunning) return;

        this.animationFrameId = requestAnimationFrame(() => this._renderLoop());

        const now = performance.now();

        // ---- FPS Tracking ----
        this.frameCount++;
        if (now - this.lastFpsUpdate >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
            this._updateFpsDisplay();
        }

        // ---- Face Detection ----
        const video = this.cameraManager.getVideoElement();
        if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            this.faceTracker.detect(video, now);
        }

        // ---- Update Headphones Mesh ----
        if (this.faceTracker.isDetected()) {
            const faceData = this.faceTracker.getFaceData();
            const snap = !this._wasFaceDetected;
            this.headphonesRenderer.update(faceData, snap);
            this._updateFaceStatus(true);

            if (!this._wasFaceDetected && (now - this._faceLostTime) > 500) {
                this.faceTracker.resetSmoothing();
            }
            this._wasFaceDetected = true;
        } else {
            this.headphonesRenderer.setVisibility(false);
            this._updateFaceStatus(false);

            if (this._wasFaceDetected) {
                this._faceLostTime = now;
            }
            this._wasFaceDetected = false;
        }

        // ---- Render WebGL ----
        this.headphonesRenderer.render();
    }

    /**
     * Select a model from the list.
     */
    async selectModel(modelId) {
        try {
            this._showLoading('Calibrating soundstage...');
            const modelData = await this.headphonesAPI.fetchHeadphonesById(modelId);

            // Set renderer category (headphones or earbuds) before loading the GLB model
            this.selectedCategory = modelData.category;
            this.headphonesRenderer.setCategory(this.selectedCategory);

            const modelUrl = this.headphonesAPI.getModelUrl(modelId);
            await this.headphonesRenderer.loadModel(modelUrl, modelData);

            this.currentModelId = modelId;
            this._updateSelectedCard(modelId);

            // Update UI description panel if elements exist
            const titleEl = document.getElementById('selected-product-title');
            const brandEl = document.getElementById('selected-product-brand');
            const descEl = document.getElementById('selected-product-desc');

            // if (titleEl) titleEl.textContent = modelData.name;
            // if (brandEl) brandEl.textContent = modelData.brand || 'Premium';
            // if (descEl) descEl.textContent = modelData.description || 'Virtual 3D Try-On model.';

            this._hideLoading();
            console.log(`[App] Loaded model: ${modelData.name}`);
        } catch (err) {
            console.error('[App] Failed to load model:', err);
            this._hideLoading();
            this._showToast('Model load failed. Displaying fallback.', 'warning');
            
            // Fall back to default procedural
            this.headphonesRenderer._loadDefaultProceduralModel();
        }
    }

    /**
     * Fetch catalog items from API.
     */
    async _loadCatalog() {
        try {
            const result = await this.headphonesAPI.fetchHeadphones(this.selectedCategory);
            this.modelList = result.headphones;
            this.originalModelList = [...result.headphones];
            this.currentPage = 1;
            this._renderCatalog();
        } catch (err) {
            console.warn('[App] Failed to load catalog from API:', err.message);
            this.modelList = [];
            this.originalModelList = [];
        }
    }

    /**
     * Filter the catalog by category.
     */
    async filterByCategory(category) {
        this.selectedCategory = category === 'all' ? null : category;
        
        // Update category tabs UI
        document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.dataset.category === category) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Set category on renderer as well if matching
        if (category === 'headphone' || category === 'earbud') {
            this.headphonesRenderer.setCategory(category);
        }

        await this._loadCatalog();

        // Select the first item in the newly filtered list if available
        if (this.modelList.length > 0) {
            await this.selectModel(this.modelList[0].id);
        } else {
            this.headphonesRenderer._loadDefaultProceduralModel();
        }
    }

    /**
     * Snapshot try-on image compositing webcam and Three.js layers.
     */
    async takeScreenshot() {
        try {
            const videoCanvas = this.cameraManager.captureFrame();
            const webglCanvas = this.headphonesRenderer.captureFrame();

            const compositeCanvas = document.createElement('canvas');
            compositeCanvas.width = videoCanvas.width;
            compositeCanvas.height = videoCanvas.height;
            const ctx = compositeCanvas.getContext('2d');

            ctx.drawImage(videoCanvas, 0, 0);
            ctx.drawImage(webglCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);

            this.shortlistImageDataUrl = compositeCanvas.toDataURL('image/png');

            const shortlistImg = document.getElementById('shortlist-image');
            const shortlistPlaceholder = document.getElementById('shortlist-placeholder');

            if (shortlistImg && shortlistPlaceholder) {
                shortlistImg.src = this.shortlistImageDataUrl;
                shortlistImg.style.display = 'block';
                shortlistPlaceholder.style.display = 'none';

                document.querySelectorAll('.shortlist-actions .action-circle-btn').forEach(btn => {
                    btn.classList.remove('disabled');
                });
            }

            this._showToast('Style captured to shortlist!', 'success');
        } catch (err) {
            console.error('[App] Capture failed:', err);
            this._showToast('Failed to take snapshot', 'error');
        }
    }

    resetShortlist() {
        this.shortlistImageDataUrl = null;
        const shortlistImg = document.getElementById('shortlist-image');
        const shortlistPlaceholder = document.getElementById('shortlist-placeholder');
        if (shortlistImg && shortlistPlaceholder) {
            shortlistImg.src = '';
            shortlistImg.style.display = 'none';
            shortlistPlaceholder.style.display = 'flex';

            document.querySelectorAll('.shortlist-actions .action-circle-btn').forEach(btn => {
                btn.classList.add('disabled');
            });
            this._showToast('Shortlist reset.', 'info');
        }
    }

    _renderCatalog() {
        const container = document.getElementById('product-list');
        if (!container) return;

        container.innerHTML = '';

        if (this.modelList.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-catalog-text';
            empty.innerHTML = `No virtual models uploaded yet.<br><span style="font-size:0.8rem;color:var(--text-muted)">Uploading a GLB from the admin panel will seed the gallery automatically.</span>`;
            container.appendChild(empty);
            return;
        }

        this.modelList.forEach(item => {
            const card = document.createElement('div');
            card.className = `catalog-card ${this.currentModelId === item.id ? 'active' : ''}`;
            card.dataset.id = item.id;

            const icon = document.createElement('div');
            icon.className = 'catalog-card-icon';
            icon.textContent = item.category === 'earbud' ? '✨' : '🎧';
            card.appendChild(icon);

            const details = document.createElement('div');
            details.className = 'catalog-card-details';

            const name = document.createElement('div');
            name.className = 'catalog-card-name';
            name.textContent = item.name;
            details.appendChild(name);

            const brand = document.createElement('div');
            brand.className = 'catalog-card-brand';
            brand.textContent = item.brand || 'Premium';
            details.appendChild(brand);

            card.appendChild(details);

            card.addEventListener('click', () => this.selectModel(item.id));
            container.appendChild(card);
        });
    }

    _updateSelectedCard(id) {
        document.querySelectorAll('.catalog-card').forEach(card => {
            if (parseInt(card.dataset.id) === id) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });
    }

    _setupEventListeners() {
        // Screenshot trigger
        const captureBtn = document.getElementById('btn-screenshot-trigger');
        if (captureBtn) {
            captureBtn.addEventListener('click', () => this.takeScreenshot());
        }

        // Category filter buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const category = e.currentTarget.dataset.category;
                this.filterByCategory(category);
            });
        });

        // Shortlist action listeners
        const resetBtn = document.getElementById('btn-reset-shortlist');
        if (resetBtn) {
            resetBtn.addEventListener('click', (e) => {
                if (e.currentTarget.classList.contains('disabled')) return;
                this.resetShortlist();
            });
        }

        const downloadBtn = document.getElementById('btn-share-shortlist');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                if (e.currentTarget.classList.contains('disabled')) return;
                if (this.shortlistImageDataUrl) {
                    const link = document.createElement('a');
                    link.download = `headphones-tryon-${Date.now()}.png`;
                    link.href = this.shortlistImageDataUrl;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    this._showToast('Screenshot downloaded!', 'success');
                }
            });
        }

        const buyBtn = document.getElementById('btn-buy-shortlist');
        if (buyBtn) {
            buyBtn.addEventListener('click', (e) => {
                if (e.currentTarget.classList.contains('disabled')) return;
                const activeModel = this.modelList.find(m => m.id === this.currentModelId);
                const query = encodeURIComponent((activeModel ? activeModel.name : 'headphones') + ' price');
                window.open(`https://www.google.com/search?q=${query}`, '_blank');
            });
        }

        // Window resize
        window.addEventListener('resize', () => {
            const video = this.cameraManager.getVideoElement();
            if (video && video.videoWidth) {
                this.headphonesRenderer.resize(video.videoWidth, video.videoHeight);
            }
        });
    }

    _updateFpsDisplay() {
        const fpsEl = document.getElementById('fps-counter');
        if (fpsEl) {
            fpsEl.textContent = `${this.fps} FPS`;
            if (this.fps >= 30) fpsEl.style.color = '#4ade80';
            else if (this.fps >= 20) fpsEl.style.color = '#f59e0b';
            else fpsEl.style.color = '#ef4444';
        }
    }

    _updateFaceStatus(detected) {
        const statusEl = document.getElementById('face-status');
        const textEl = document.getElementById('face-status-text');
        if (!statusEl) return;

        if (detected) {
            statusEl.classList.add('detected');
            if (textEl) textEl.textContent = 'Head Locked';
        } else {
            statusEl.classList.remove('detected');
            if (textEl) textEl.textContent = 'Scanning Head';
        }
    }

    _showLoading(message) {
        const overlay = document.getElementById('loading-overlay');
        const msgEl = document.getElementById('loading-message');
        if (msgEl) msgEl.textContent = message;
        if (overlay) overlay.style.display = 'flex';
    }

    _hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    _showError(message) {
        const overlay = document.getElementById('error-overlay');
        const msgEl = document.getElementById('error-message');
        if (msgEl) msgEl.textContent = message;
        if (overlay) overlay.style.display = 'flex';
    }

    _showToast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#06b6d4'
        };

        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.style.background = colors[type] || colors.info;
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 3000);
    }
}

// Auto-initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
    const app = new HeadphonesApp();
    window.app = app;
    app.init();
});
