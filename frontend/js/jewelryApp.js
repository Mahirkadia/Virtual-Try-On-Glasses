/**
 * JewelryTryOnApp - Main application controller for the Virtual Jewelry Try-On.
 * Co-ordinates CameraManager, HandTracker, and JewelryRenderer.
 */
class JewelryTryOnApp {
    constructor() {
        /** @type {CameraManager} */
        this.cameraManager = new CameraManager();
        /** @type {HandTracker} */
        this.handTracker = new HandTracker();
        /** @type {JewelryRenderer} */
        this.jewelryRenderer = new JewelryRenderer();
        /** @type {JewelryAPI} */
        this.jewelryAPI = new JewelryAPI();

        this.isRunning = false;
        this.currentCategory = 'ring'; // 'ring'
        this.currentProductId = null;
        this.animationFrameId = null;

        // In-memory catalog of high-end jewelry items
        this.catalog = {
            ring: []
        };

        this.shortlistImageDataUrl = null;

        // Performance metrics
        this.fps = 0;
        this.frameCount = 0;
        this.lastFpsUpdate = 0;

        // Status tracking
        this._wasHandDetected = false;
        this._handLostTime = 0;
    }

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
     * Initialize camera, MediaPipe hand landmarker, Three.js WebGL and start the loop.
     */
    async init() {
        try {
            const videoEl = document.getElementById('camera-video');
            const canvasEl = document.getElementById('jewelry-canvas');

            if (!videoEl) throw new Error('Video element #camera-video not found.');
            if (!canvasEl) throw new Error('Canvas element #jewelry-canvas not found.');

            this._showLoading('Loading virtual showroom libraries...');

            await Promise.all([
                // 1. Camera Manager
                this.cameraManager.init(videoEl).then(() => {
                    console.log('[JewelryApp] Camera initialized.');
                }),

                // 2. MediaPipe Hand Tracker
                this._waitForLib(
                    '__mediapipeReady',
                    'mediapipe-ready',
                    () => typeof window.HandLandmarker !== 'undefined'
                ).then(() => this.handTracker.init()).then(() => {
                    console.log('[JewelryApp] Hand Tracker initialized.');
                }),

                // 3. Three.js
                this._waitForLib(
                    '__threejsReady',
                    'threejs-ready',
                    () => typeof window.THREE !== 'undefined'
                ).then(() => {
                    console.log('[JewelryApp] Three.js libraries ready.');
                })
            ]);

            // 4. Initialize Three.js WebGL viewport
            const { width: videoWidth, height: videoHeight } = this.cameraManager.getVideoDimensions();
            // Tiny delay for DOM rendering
            await new Promise(r => requestAnimationFrame(r));
            this.jewelryRenderer.init(canvasEl, videoWidth, videoHeight);

            // 5. Setup UI buttons
            this._setupEventListeners();

            // Load catalog from API
            await this._loadCatalog();

            // Set default category
            this.setCategory('ring');

            this._hideLoading();
            this.isRunning = true;
            this.lastFpsUpdate = performance.now();
            this._renderLoop();

            console.log('[JewelryApp] VTO ready!');
        } catch (err) {
            console.error('[JewelryApp] Init failed:', err);
            this._hideLoading();
            this._showError(err.message);
        }
    }

    /**
     * Fetch catalog items from the database and distribute into categories.
     * @private
     */
    async _loadCatalog() {
        try {
            this._showLoading('Loading jewelry catalog...');
            const result = await this.jewelryAPI.fetchJewelry(null, 0, 200);

            // Populate catalog with high-fidelity fallback items first
            // this.catalog = {
            //     ring: [
            //         { id: 'ring_1', name: 'Solitaire Gold Ring', brand: 'Classic', desc: 'Elegant classic gold solitaire diamond ring.', thumbnail: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%2308080a" rx="15" stroke="%23c5a880" stroke-width="1"/><text x="50" y="65" font-size="50" text-anchor="middle">💍</text></svg>' },
            //         { id: 'ring_2', name: 'Rose Gold Emerald Ring', brand: 'Luxury', desc: 'Premium rose gold band with vibrant emerald green gemstone.', thumbnail: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%2308080a" rx="15" stroke="%23c5a880" stroke-width="1"/><text x="50" y="65" font-size="50" text-anchor="middle">💚</text></svg>' }
            //     ]
            // };

            // Distribute items from database
            result.jewelry.forEach(item => {
                const cat = item.category || 'ring';
                if (cat === 'ring' && this.catalog[cat]) {
                    this.catalog[cat].push({
                        id: item.id,
                        name: item.name,
                        brand: item.brand || 'Luxury',
                        desc: item.description || '',
                        thumbnail: this.jewelryAPI.getThumbnailUrl(item.id),
                        metadata: item
                    });
                }
            });

            console.log('[JewelryApp] Catalog items loaded.');
        } catch (err) {
            console.error('[JewelryApp] Failed to load dynamic catalog:', err);
        }
    }

    /**
     * Switch jewelry category.
     * @param {'ring'} category
     */
    setCategory(category) {
        if (!this.catalog[category]) return;
        this.currentCategory = category;

        // Tell renderer to change occlusion shapes
        this.jewelryRenderer.setType(category);

        // Re-render product catalog sidebar
        this._renderCatalogSidebar();

        // Select first item in the new category
        const firstProduct = this.catalog[category][0];
        if (firstProduct) {
            this.selectProduct(firstProduct.id);
        }
    }

    /**
     * Select a specific jewelry product.
     */
    async selectProduct(productId) {
        this.currentProductId = productId;

        // Update selected card state in sidebar
        document.querySelectorAll('.product-card').forEach(card => {
            if (card.dataset.id === String(productId)) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });

        // Update product info overlay
        const product = this.catalog[this.currentCategory].find(p => String(p.id) === String(productId));
        if (product) {
            document.getElementById('selected-product-title').textContent = product.name;
            document.getElementById('selected-product-brand').textContent = product.brand;
            document.getElementById('selected-product-desc').textContent = product.desc;
        }

        // Apply product-specific model adjustments
        const renderer = this.jewelryRenderer;
        
        // Check if this is a dynamic product (database loaded)
        const isMock = typeof productId === 'string' && productId.startsWith('ring_');

        if (!isMock && product && product.metadata) {
            // Dynamic model loading
            const modelUrl = this.jewelryAPI.getModelUrl(productId);
            await renderer.loadModel(modelUrl, product.metadata);
        } else {
            // Fallback: Apply product-specific mock adjustments on top of default procedural models
            renderer._loadDefaultProceduralModel();
            
            const currentModelGroup = renderer.currentModel;
            if (currentModelGroup && this.currentCategory === 'ring') {
                if (productId === 'ring_2') {
                    // Rose Gold Emerald Ring
                    currentModelGroup.traverse((child) => {
                        if (child.isMesh && child.material) {
                            if (child.material.color.getHexString() === 'ffdf00') {
                                child.material.color.setHex(0xe0a899); // Rose Gold band
                                child.material.roughness = 0.25;
                            } else if (child.material.color.getHexString() === '00ffff') {
                                child.material.color.setHex(0x00ff00); // Emerald green gem
                            }
                        }
                    });
                }
            }
        }

        console.log(`[JewelryApp] Selected product: ${productId}`);
    }

    /**
     * Main animation loop.
     * @private
     */
    _renderLoop() {
        if (!this.isRunning) return;

        this.animationFrameId = requestAnimationFrame(() => this._renderLoop());

        const now = performance.now();

        // 1. FPS Tracker
        this.frameCount++;
        if (now - this.lastFpsUpdate >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
            this._updateFpsDisplay();
        }

        // 2. Run hand tracking
        const video = this.cameraManager.getVideoElement();
        if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            this.handTracker.detect(video, now);
        }

        // 3. Update Three.js model positions based on hand tracking
        if (this.handTracker.isDetected()) {
            const trackData = this.handTracker.getRingData('ring');
            const snap = !this._wasHandDetected;
            this.jewelryRenderer.update(trackData, snap);
            this._updateHandStatus(true);

            if (!this._wasHandDetected && (now - this._handLostTime) > 500) {
                this.handTracker.resetSmoothing();
            }
            this._wasHandDetected = true;
        } else {
            this.jewelryRenderer.setVisibility(false);
            this._updateHandStatus(false);

            if (this._wasHandDetected) {
                this._handLostTime = now;
            }
            this._wasHandDetected = false;
        }

        // 4. Render frame
        this.jewelryRenderer.render();
    }

    /**
     * Capture screenshot and put in sidebar.
     */
    takeScreenshot() {
        try {
            const videoCanvas = this.cameraManager.captureFrame();
            const jewelryCanvas = this.jewelryRenderer.captureFrame();

            const compositeCanvas = document.createElement('canvas');
            compositeCanvas.width = videoCanvas.width;
            compositeCanvas.height = videoCanvas.height;
            const ctx = compositeCanvas.getContext('2d');

            ctx.drawImage(videoCanvas, 0, 0);
            ctx.drawImage(jewelryCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);

            this.shortlistImageDataUrl = compositeCanvas.toDataURL('image/png');

            const shortlistImg = document.getElementById('shortlist-image');
            const shortlistPlaceholder = document.getElementById('shortlist-placeholder');
            if (shortlistImg && shortlistPlaceholder) {
                shortlistImg.src = this.shortlistImageDataUrl;
                shortlistImg.style.display = 'block';
                shortlistPlaceholder.style.display = 'none';

                // Enable action buttons
                document.querySelectorAll('.shortlist-actions .action-circle-btn').forEach(btn => {
                    btn.classList.remove('disabled');
                });
            }
            this._showToast('Captured photo! View style in the Right Sidebar.', 'success');
        } catch (err) {
            console.error('[JewelryApp] Screenshot failed:', err);
            this._showToast('Failed to take photo', 'error');
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
            this._showToast('Shortlist cleared', 'info');
        }
    }

    // ========================================================================
    // UI Helpers
    // ========================================================================

    _renderCatalogSidebar() {
        const list = document.getElementById('product-list');
        if (!list) return;

        list.innerHTML = '';
        const items = this.catalog[this.currentCategory] || [];

        items.forEach(product => {
            const card = document.createElement('div');
            card.className = 'product-card';
            card.dataset.id = product.id;

            card.innerHTML = `
                <img class="product-card-image" src="${product.thumbnail}" alt="${product.name}">
                <div class="product-card-info">
                    <span class="product-card-name">${product.name}</span>
                    <span class="product-card-brand">${product.brand}</span>
                </div>
            `;

            card.addEventListener('click', () => this.selectProduct(product.id));
            list.appendChild(card);
        });
    }

    _setupEventListeners() {
        // Screenshot
        const captureBtn = document.getElementById('btn-screenshot-trigger');
        if (captureBtn) {
            captureBtn.addEventListener('click', () => this.takeScreenshot());
        }

        // Reset Shortlist
        const resetShortlistBtn = document.getElementById('btn-reset-shortlist');
        if (resetShortlistBtn) {
            resetShortlistBtn.addEventListener('click', (e) => {
                if (e.currentTarget.classList.contains('disabled')) return;
                this.resetShortlist();
            });
        }

        // Share/Save
        const shareShortlistBtn = document.getElementById('btn-share-shortlist');
        if (shareShortlistBtn) {
            shareShortlistBtn.addEventListener('click', (e) => {
                if (e.currentTarget.classList.contains('disabled')) return;
                if (this.shortlistImageDataUrl) {
                    const link = document.createElement('a');
                    link.download = `jewelry-tryon-${Date.now()}.png`;
                    link.href = this.shortlistImageDataUrl;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            });
        }

        // Buy button
        const buyShortlistBtn = document.getElementById('btn-buy-shortlist');
        if (buyShortlistBtn) {
            buyShortlistBtn.addEventListener('click', (e) => {
                if (e.currentTarget.classList.contains('disabled')) return;
                const product = this.catalog[this.currentCategory].find(p => p.id === this.currentProductId);
                if (product) {
                    const query = encodeURIComponent(`${product.brand} ${product.name}`);
                    window.open(`https://www.google.com/search?q=${query}`, '_blank');
                }
            });
        }

        // Window resize
        window.addEventListener('resize', () => {
            if (this.cameraManager) {
                const dims = this.cameraManager.getVideoDimensions();
                if (dims.width > 0) {
                    this.jewelryRenderer.resize(dims.width, dims.height);
                }
            }
        });
    }

    _updateFpsDisplay() {
        const fpsEl = document.getElementById('fps-counter');
        if (fpsEl) {
            fpsEl.textContent = `${this.fps} FPS`;
            if (this.fps >= 30) {
                fpsEl.style.color = '#45f3ff'; // Neon Cyan
            } else if (this.fps >= 20) {
                fpsEl.style.color = '#ffaa00'; // Orange
            } else {
                fpsEl.style.color = '#ff4b4b'; // Red
            }
        }
    }

    _updateHandStatus(detected) {
        const statusEl = document.getElementById('hand-status');
        const textEl = document.getElementById('hand-status-text');
        if (!statusEl) return;

        if (detected) {
            statusEl.classList.add('detected');
            if (textEl) textEl.textContent = 'Hand Detected';
        } else {
            statusEl.classList.remove('detected');
            if (textEl) textEl.textContent = 'No Hand';
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
        const errScreen = document.getElementById('error-overlay') || document.createElement('div');
        const msgEl = document.getElementById('error-message');
        if (msgEl) msgEl.textContent = message;
        if (errScreen) errScreen.style.display = 'flex';
    }

    _showToast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        const colors = {
            success: '#45f3ff',
            error: '#ff4b4b',
            info: '#c5a880'
        };

        const toast = document.createElement('div');
        toast.className = 'toast-item';
        toast.style.backgroundColor = 'rgba(15, 15, 20, 0.9)';
        toast.style.borderLeft = `4px solid ${colors[type] || colors.info}`;
        toast.textContent = message;

        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 3000);
    }
}

// Auto-initialize when content loads
document.addEventListener('DOMContentLoaded', () => {
    window.app = new JewelryTryOnApp();
    window.app.init();
});
