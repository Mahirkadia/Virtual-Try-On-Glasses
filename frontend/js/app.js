/**
 * VirtualTryOnApp - Main application controller for the Virtual Glasses Try-On.
 * Orchestrates CameraManager, FaceTracker, GlassesRenderer, and GlassesAPI
 * into a cohesive real-time AR experience.
 *
 * Prerequisites (loaded via script tags before this file):
 *   1. cameraManager.js
 *   2. faceTracker.js
 *   3. glassesRenderer.js
 *   4. glassesAPI.js
 *   5. Three.js + GLTFLoader from CDN
 *   6. MediaPipe Tasks Vision from CDN
 *
 * Usage:
 *   <script src="js/cameraManager.js"></script>
 *   <script src="js/faceTracker.js"></script>
 *   <script src="js/glassesRenderer.js"></script>
 *   <script src="js/glassesAPI.js"></script>
 *   <script src="js/app.js"></script>
 *   // App auto-initializes on DOMContentLoaded
 */
class VirtualTryOnApp {
    constructor() {
        /** @type {CameraManager} */
        this.cameraManager = new CameraManager();
        /** @type {FaceTracker} */
        this.faceTracker = new FaceTracker();
        /** @type {GlassesRenderer} */
        this.glassesRenderer = new GlassesRenderer();
        /** @type {GlassesAPI} */
        this.glassesAPI = new GlassesAPI();

        /** @type {boolean} */
        this.isRunning = false;
        /** @type {number|null} */
        this.currentGlassesId = null;
        /** @type {Array} */
        this.glassesList = [];
        /** @type {Array} */
        this.originalGlassesList = []; // Full list cache for filters
        /** @type {Array} */
        this.categories = [];
        /** @type {string|null} */
        this.selectedCategory = null;
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

        // Face lost/found tracking for UI feedback
        /** @type {boolean} */
        this._wasFaceDetected = false;
        /** @type {number} */
        this._faceeLostTime = 0;
    }

    /**
     * Wait for a global library to be available, checking both a ready flag
     * (set before the event fires) and the event itself to avoid race conditions.
     * @param {string} flagName - window property name set to true when ready
     * @param {string} eventName - event dispatched on window when ready
     * @param {Function} isReady - predicate that returns true when the lib is loaded
     * @returns {Promise<void>}
     * @private
     */
    _waitForLib(flagName, eventName, isReady) {
        if (window[flagName] || isReady()) return Promise.resolve();
        return new Promise((resolve) => {
            // Catch the event in case it fires after this runs
            window.addEventListener(eventName, resolve, { once: true });
            // Also poll, in case the event already fired before we added the listener
            const t = setInterval(() => {
                if (isReady()) { clearInterval(t); resolve(); }
            }, 50);
        });
    }

    /**
     * Initialize the entire application.
     * @returns {Promise<void>}
     */
    async init() {
        try {
            const videoEl = document.getElementById('camera-video');
            const canvasEl = document.getElementById('glasses-canvas');

            if (!videoEl) throw new Error('Video element #camera-video not found in the page.');
            if (!canvasEl) throw new Error('Canvas element #glasses-canvas not found in the page.');

            this._showLoading('Starting up...');

            // Run camera init, MediaPipe load, Three.js load, and catalog fetch in parallel
            const [, , ,] = await Promise.all([
                // Camera
                this.cameraManager.init(videoEl).then(() => {
                    console.log(`[App] Camera ready: ${this.cameraManager.getVideoDimensions().width}x${this.cameraManager.getVideoDimensions().height}`);
                }),

                // MediaPipe → face tracker
                this._waitForLib(
                    '__mediapipeReady',
                    'mediapipe-ready',
                    () => typeof window.FaceLandmarker !== 'undefined'
                ).then(() => this.faceTracker.init()).then(() => {
                    console.log('[App] Face tracker ready.');
                }),

                // Three.js
                this._waitForLib(
                    '__threejsReady',
                    'threejs-ready',
                    () => typeof window.THREE !== 'undefined' && typeof window.THREE.GLTFLoader !== 'undefined'
                ).then(() => {
                    console.log('[App] Three.js ready.');
                }),

                // Catalog (can load independently)
                this._loadCatalog().then(() => {
                    console.log(`[App] Catalog loaded: ${this.glassesList.length} glasses.`);
                }),
            ]);

            // Renderer: video resolution canvas, visually scaled to container by JS
            const { width: videoWidth, height: videoHeight } = this.cameraManager.getVideoDimensions();
            // Small delay so the DOM has laid out the container before we measure it
            await new Promise(r => requestAnimationFrame(r));
            this.glassesRenderer.init(canvasEl, videoWidth, videoHeight);
            console.log('[App] Renderer ready.');

            // Event listeners
            this._setupEventListeners();

            // Hide loading, start render loop
            this._hideLoading();
            this.isRunning = true;
            this.lastFpsUpdate = performance.now();
            this._renderLoop();

            // Auto-select first glasses
            if (this.glassesList.length > 0) {
                await this.selectGlasses(this.glassesList[0].id);
            }

            console.log('[App] Virtual Try-On initialized successfully!');
        } catch (error) {
            console.error('[App] Initialization failed:', error);
            this._hideLoading();
            this._showError(error.message);
        }
    }

    /**
     * Main render loop using requestAnimationFrame.
     * @private
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

        // ---- Update Glasses ----
        if (this.faceTracker.isDetected()) {
            const faceData = this.faceTracker.getFaceData();
            const snap = !this._wasFaceDetected;
            this.glassesRenderer.update(faceData, snap);
            this._updateFaceStatus(true);

            // Reset smoothing if face was just re-found after being lost for > 500ms
            if (!this._wasFaceDetected && (now - this._faceeLostTime) > 500) {
                this.faceTracker.resetSmoothing();
            }
            this._wasFaceDetected = true;
        } else {
            this.glassesRenderer.setVisibility(false);
            this._updateFaceStatus(false);

            if (this._wasFaceDetected) {
                this._faceeLostTime = now;
            }
            this._wasFaceDetected = false;
        }

        // ---- Render ----
        this.glassesRenderer.render();
    }

    /**
     * Select and load a glasses model by ID.
     * @param {number|string} glassesId
     * @returns {Promise<void>}
     */
    async selectGlasses(glassesId) {
        if (this.currentGlassesId === glassesId) return;

        try {
            // Fetch metadata
            const glasses = await this.glassesAPI.fetchGlassesById(glassesId);

            // Load 3D model
            const modelUrl = this.glassesAPI.getModelUrl(glassesId);
            await this.glassesRenderer.loadModel(modelUrl, glasses);

            this.currentGlassesId = glassesId;

            // Update UI
            this._updateSelectedCard(glassesId);

            console.log(`[App] Selected glasses: ${glasses.name || glassesId}`);
        } catch (error) {
            console.error('[App] Failed to load glasses:', error);
            this._showToast('Failed to load glasses model', 'error');
        }
    }

    /**
     * Load the glasses catalog from the API.
     * @private
     */
    async _loadCatalog() {
        try {
            // Fetch categories
            this.categories = await this.glassesAPI.fetchCategories();

            // Fetch all glasses
            const result = await this.glassesAPI.fetchGlasses(this.selectedCategory);
            this.glassesList = result.glasses;
            this.originalGlassesList = [...result.glasses]; // Cache full list
            this.currentPage = 1;
            this._renderGlassesCarousel();
        } catch (err) {
            console.warn('[App] Failed to load catalog:', err.message);
            this.glassesList = [];
            this.originalGlassesList = [];
            this.categories = [];
        }
    }

    /**
     * Filter glasses by category.
     * @param {string} category - Category name or 'all'
     * @returns {Promise<void>}
     */
    async filterByCategory(category) {
        this.selectedCategory = category === 'all' ? null : category;

        try {
            const result = await this.glassesAPI.fetchGlasses(this.selectedCategory);
            this.glassesList = result.glasses;
            this.originalGlassesList = [...result.glasses]; // Update cache
            this.currentPage = 1;
            this._renderGlassesCarousel();
        } catch (err) {
            console.error('[App] Failed to filter:', err);
            this._showToast('Failed to load glasses', 'error');
        }
    }

    /**
     * Filter glasses list client-side based on filter type.
     * @param {string} filterType - 'gender' | 'brand' | 'price'
     */
    applyFilters(filterType) {
        const btn = document.getElementById(`filter-${filterType}`);
        if (!btn) return;

        const wasActive = btn.classList.contains('active');

        // Reset all filter buttons active states
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));

        if (!wasActive) {
            btn.classList.add('active');

            if (filterType === 'gender') {
                // Filter client-side: alternate based on sunglasses or eyeglasses category
                this.glassesList = this.originalGlassesList.filter(g => 
                    g.category.toLowerCase().includes('sunglasses') || 
                    (g.description && g.description.toLowerCase().includes('sunglasses'))
                );
            } else if (filterType === 'brand') {
                // Filter glasses that have a brand name defined, or default to Ray-Ban
                this.glassesList = this.originalGlassesList.filter(g => g.brand || g.name.toLowerCase().includes('ray-ban') || g.name.toLowerCase().includes('classic'));
            } else if (filterType === 'price') {
                // Sort by name as a mock sort
                this.glassesList = [...this.originalGlassesList].sort((a, b) => a.name.localeCompare(b.name));
            }
        } else {
            // Restore full list
            this.glassesList = [...this.originalGlassesList];
        }

        this.currentPage = 1;
        this._renderGlassesCarousel();
        this._showToast(`Filtered by ${filterType}`, 'info');
    }

    /**
     * Capture a screenshot compositing the video and glasses overlay.
     * Renders into right sidebar shortlist container instead of direct download.
     */
    async takeScreenshot(downloadImmediately = false) {
        try {
            // 1. Get video frame (already handles mirror)
            const videoCanvas = this.cameraManager.captureFrame();

            // 2. Get glasses canvas
            const glassesCanvas = this.glassesRenderer.captureFrame();

            // 3. Composite
            const compositeCanvas = document.createElement('canvas');
            compositeCanvas.width = videoCanvas.width;
            compositeCanvas.height = videoCanvas.height;
            const ctx = compositeCanvas.getContext('2d');

            // Draw video frame
            ctx.drawImage(videoCanvas, 0, 0);

            // Draw glasses overlay on top (preserving transparency)
            ctx.drawImage(glassesCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);

            this.shortlistImageDataUrl = compositeCanvas.toDataURL('image/png');

            // 4. Update Right Sidebar Shortlist preview
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

            if (downloadImmediately) {
                const link = document.createElement('a');
                link.download = `virtual-tryon-${Date.now()}.png`;
                link.href = this.shortlistImageDataUrl;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                this._showToast('Screenshot downloaded!', 'success');
            } else {
                this._showToast('Captured photo! View style in the Right Sidebar.', 'success');
            }
        } catch (err) {
            console.error('[App] Screenshot failed:', err);
            this._showToast('Failed to take screenshot', 'error');
        }
    }

    /**
     * Reset the shortlisted style picture.
     */
    resetShortlist() {
        this.shortlistImageDataUrl = null;
        const shortlistImg = document.getElementById('shortlist-image');
        const shortlistPlaceholder = document.getElementById('shortlist-placeholder');
        if (shortlistImg && shortlistPlaceholder) {
            shortlistImg.src = '';
            shortlistImg.style.display = 'none';
            shortlistPlaceholder.style.display = 'flex';

            // Disable action buttons
            document.querySelectorAll('.shortlist-actions .action-circle-btn').forEach(btn => {
                btn.classList.add('disabled');
            });
            this._showToast('Shortlist cleared', 'info');
        }
    }

    // ========================================================================
    // UI Rendering Methods
    // ========================================================================

    _renderCategories() {
        // Obsolete in Jeeliz UI — handled via filters
    }

    /**
     * Render the glasses list inside the vertical left list container with pagination.
     * @private
     */
    _renderGlassesCarousel() {
        const container = document.getElementById('glasses-vertical-list');
        if (!container) return;

        container.innerHTML = '';

        if (this.glassesList.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'carousel-empty';
            empty.textContent = 'No glasses available';
            container.appendChild(empty);
            return;
        }

        // Apply client-side pagination
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginatedGlasses = this.glassesList.slice(startIndex, endIndex);

        paginatedGlasses.forEach(glasses => {
            const card = document.createElement('div');
            card.className = 'glasses-card';
            card.dataset.id = glasses.id;

            if (this.currentGlassesId === glasses.id) {
                card.classList.add('active');
            }

            // Thumbnail image
            const img = document.createElement('img');
            img.className = 'glasses-card-image';
            img.alt = glasses.name || 'Glasses';
            img.loading = 'lazy';

            if (glasses.thumbnail_url) {
                img.src = glasses.thumbnail_url;
            } else {
                img.src = this.glassesAPI.getThumbnailUrl(glasses.id);
            }

            img.onerror = () => {
                img.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.className = 'glasses-card-placeholder';
                placeholder.textContent = '👓';
                card.insertBefore(placeholder, card.firstChild);
            };

            card.appendChild(img);

            // Info container
            const infoDiv = document.createElement('div');
            infoDiv.className = 'glasses-card-info';

            // Name label
            const name = document.createElement('span');
            name.className = 'glasses-card-name';
            name.textContent = glasses.name || `Glasses #${glasses.id}`;
            infoDiv.appendChild(name);

            // See Prices button
            const priceBtn = document.createElement('button');
            priceBtn.className = 'glasses-card-btn';
            priceBtn.innerHTML = '🏷️ See Prices';
            infoDiv.appendChild(priceBtn);

            card.appendChild(infoDiv);

            // Click handler
            card.addEventListener('click', () => this.selectGlasses(glasses.id));

            container.appendChild(card);
        });

        // Render Pagination buttons
        this._renderPagination();
    }

    /**
     * Renders the page numbers.
     * @private
     */
    _renderPagination() {
        const container = document.getElementById('catalog-pagination');
        if (!container) return;

        container.innerHTML = '';

        const totalItems = this.glassesList.length;
        const totalPages = Math.ceil(totalItems / this.itemsPerPage) || 1;

        if (totalPages <= 1) return; // No pagination needed for single page

        // Helper to append a page button
        const appendPageButton = (pageNumber) => {
            const pageBtn = document.createElement('button');
            pageBtn.className = `page-btn ${this.currentPage === pageNumber ? 'active' : ''}`;
            pageBtn.textContent = pageNumber;
            pageBtn.addEventListener('click', () => {
                this.currentPage = pageNumber;
                this._renderGlassesCarousel();
            });
            container.appendChild(pageBtn);
        };

        // Render page buttons (shows all or simple range)
        for (let i = 1; i <= totalPages; i++) {
            appendPageButton(i);
        }
    }

    /**
     * Highlight the selected glasses card.
     * @param {number|string} id
     * @private
     */
    _updateSelectedCard(id) {
        const container = document.getElementById('glasses-vertical-list');
        if (!container) return;

        // Remove previous selection
        container.querySelectorAll('.glasses-card.active').forEach(card => {
            card.classList.remove('active');
        });

        // Add selection to new card
        const selectedCard = container.querySelector(`.glasses-card[data-id="${id}"]`);
        if (selectedCard) {
            selectedCard.classList.add('active');
            selectedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    /**
     * Update the active state of category tabs (No-op in new UI).
     * @private
     */
    _updateCategoryTabs() {
        // Obsolete
    }

    /**
     * Update the FPS counter display.
     * @private
     */
    _updateFpsDisplay() {
        const fpsEl = document.getElementById('fps-counter');
        if (fpsEl) {
            fpsEl.textContent = `${this.fps} FPS`;

            // Color-code FPS
            if (this.fps >= 30) {
                fpsEl.style.color = '#4caf50'; // Green
            } else if (this.fps >= 20) {
                fpsEl.style.color = '#ff9800'; // Orange
            } else {
                fpsEl.style.color = '#f44336'; // Red
            }
        }
    }

    /**
     * Update the face detection status indicator.
     * @param {boolean} detected
     * @private
     */
    _updateFaceStatus(detected) {
        const statusEl = document.getElementById('face-status');
        const textEl = document.getElementById('face-status-text');
        if (!statusEl) return;

        if (detected) {
            statusEl.classList.add('detected');
            if (textEl) textEl.textContent = 'Face Detected';
        } else {
            statusEl.classList.remove('detected');
            if (textEl) textEl.textContent = 'No Face';
        }
    }

    /**
     * Show the loading overlay with a message.
     * @param {string} message
     * @private
     */
    _showLoading(message) {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;

        // Update message — HTML uses id="loading-message"
        const msgEl = document.getElementById('loading-message') ||
                      overlay.querySelector('.loading-message') ||
                      overlay.querySelector('.loading-text');
        if (msgEl) msgEl.textContent = message;

        overlay.style.display = 'flex';
    }

    /**
     * Hide the loading overlay.
     * @private
     */
    _hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    /**
     * Show an error screen with a retry option.
     * @param {string} message
     * @private
     */
    _showError(message) {
        let errorScreen = document.getElementById('error-screen');

        if (!errorScreen) {
            errorScreen = document.createElement('div');
            errorScreen.id = 'error-screen';
            errorScreen.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.9); display: flex; align-items: center;
                justify-content: center; z-index: 10001; color: white; text-align: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            `;
            document.body.appendChild(errorScreen);
        }

        errorScreen.innerHTML = `
            <div style="max-width: 500px; padding: 40px;">
                <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                <h2 style="margin-bottom: 15px; color: #ff5252;">Something went wrong</h2>
                <p style="margin-bottom: 25px; color: #ccc; line-height: 1.6;">${this._escapeHtml(message)}</p>
                <button id="error-retry-btn" style="
                    padding: 12px 32px; background: #2196f3; color: white;
                    border: none; border-radius: 8px; font-size: 16px;
                    cursor: pointer; transition: background 0.2s;
                ">Try Again</button>
            </div>
        `;

        errorScreen.style.display = 'flex';

        const retryBtn = document.getElementById('error-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                errorScreen.style.display = 'none';
                this.stop();
                window.location.reload();
            });
        }
    }

    /**
     * Show a toast notification.
     * @param {string} message
     * @param {'success'|'error'|'info'|'warning'} [type='info']
     * @private
     */
    _showToast(message, type = 'info') {
        // Get or create toast container
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = `
                position: fixed; top: 20px; right: 20px; z-index: 10002;
                display: flex; flex-direction: column; gap: 10px;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }

        const colors = {
            success: { bg: '#4caf50', icon: '✓' },
            error: { bg: '#f44336', icon: '✕' },
            warning: { bg: '#ff9800', icon: '⚠' },
            info: { bg: '#2196f3', icon: 'ℹ' }
        };

        const style = colors[type] || colors.info;

        const toast = document.createElement('div');
        toast.style.cssText = `
            background: ${style.bg}; color: white; padding: 12px 20px;
            border-radius: 8px; font-size: 14px; pointer-events: auto;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: center;
            gap: 8px; animation: slideIn 0.3s ease-out;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 350px;
        `;
        toast.innerHTML = `<span>${style.icon}</span> <span>${this._escapeHtml(message)}</span>`;

        container.appendChild(toast);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s, transform 0.3s';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    // ========================================================================
    // Event Listeners
    // ========================================================================

    /**
     * Set up all DOM event listeners.
     * @private
     */
    _setupEventListeners() {
        // Screenshot trigger button (center overlay)
        const captureBtn = document.getElementById('btn-screenshot-trigger');
        if (captureBtn) {
            captureBtn.addEventListener('click', () => this.takeScreenshot(false));
        }

        // Overlay Navigation Arrows
        const prevBtn = document.getElementById('btn-prev-glasses');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this._navigateGlasses(-1));
        }

        const nextBtn = document.getElementById('btn-next-glasses');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this._navigateGlasses(1));
        }

        // Shortlist circular action buttons
        const resetShortlistBtn = document.getElementById('btn-reset-shortlist');
        if (resetShortlistBtn) {
            resetShortlistBtn.addEventListener('click', (e) => {
                if (e.currentTarget.classList.contains('disabled')) return;
                this.resetShortlist();
            });
        }

        const shareShortlistBtn = document.getElementById('btn-share-shortlist');
        if (shareShortlistBtn) {
            shareShortlistBtn.addEventListener('click', (e) => {
                if (e.currentTarget.classList.contains('disabled')) return;
                // Reuse takeScreenshot download code using the cached image DataURL
                if (this.shortlistImageDataUrl) {
                    const link = document.createElement('a');
                    link.download = `shortlisted-style-${Date.now()}.png`;
                    link.href = this.shortlistImageDataUrl;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    this._showToast('Shortlist photo saved!', 'success');
                }
            });
        }

        const buyShortlistBtn = document.getElementById('btn-buy-shortlist');
        if (buyShortlistBtn) {
            buyShortlistBtn.addEventListener('click', (e) => {
                if (e.currentTarget.classList.contains('disabled')) return;
                this._showToast('Redirecting to retailer...', 'info');
                // Open mock search for current glasses
                const currentGlasses = this.glassesList.find(g => g.id === this.currentGlassesId);
                if (currentGlasses) {
                    const query = encodeURIComponent(currentGlasses.name || 'sunglasses');
                    window.open(`https://www.google.com/search?q=${query}+price`, '_blank');
                }
            });
        }

        // Bottom links on center viewport
        const framePosLink = document.getElementById('link-frame-position');
        if (framePosLink) {
            framePosLink.addEventListener('click', () => {
                this._showToast('Opening Frame position adjustments in Admin Panel...', 'info');
                setTimeout(() => { window.location.href = '/admin'; }, 1000);
            });
        }

        const allPricesLink = document.getElementById('link-all-prices');
        if (allPricesLink) {
            allPricesLink.addEventListener('click', () => {
                if (this.currentGlassesId) {
                    const currentGlasses = this.glassesList.find(g => g.id === this.currentGlassesId);
                    if (currentGlasses) {
                        const query = encodeURIComponent(currentGlasses.name);
                        window.open(`https://www.google.com/search?q=${query}+prices+buy`, '_blank');
                        return;
                    }
                }
                window.open('https://www.google.com/search?q=sunglasses+buy', '_blank');
            });
        }

        // Vintage Filter Toggle
        const vintageToggle = document.getElementById('vintage-filter-toggle');
        if (vintageToggle) {
            vintageToggle.addEventListener('change', (e) => {
                const videoEl = document.getElementById('camera-video');
                const canvasEl = document.getElementById('glasses-canvas');
                if (videoEl && canvasEl) {
                    if (e.target.checked) {
                        videoEl.classList.add('vintage-active');
                        canvasEl.classList.add('vintage-active');
                        this._showToast('Vintage filter: ON', 'success');
                    } else {
                        videoEl.classList.remove('vintage-active');
                        canvasEl.classList.remove('vintage-active');
                        this._showToast('Vintage filter: OFF', 'info');
                    }
                }
            });
        }

        // Client-side Filter buttons
        const filterGender = document.getElementById('filter-gender');
        if (filterGender) {
            filterGender.addEventListener('click', () => this.applyFilters('gender'));
        }

        const filterBrand = document.getElementById('filter-brand');
        if (filterBrand) {
            filterBrand.addEventListener('click', () => this.applyFilters('brand'));
        }

        const filterPrice = document.getElementById('filter-price');
        if (filterPrice) {
            filterPrice.addEventListener('click', () => this.applyFilters('price'));
        }

        // Window resize
        window.addEventListener('resize', this._onResize.bind(this));

        // Visibility change (pause when tab hidden)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this._pause();
            } else {
                this._resume();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // 'S' for screenshot
            if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
                this.takeScreenshot(true); // Download on shortcut
            }
            // 'F' for fullscreen
            if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
                this._toggleFullscreen();
            }
            // Left/Right arrows for glasses navigation
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                this._navigateGlasses(e.key === 'ArrowRight' ? 1 : -1);
            }
        });
    }

    /**
     * Navigate to the next or previous glasses in the list.
     * @param {number} direction - 1 for next, -1 for previous
     * @private
     */
    _navigateGlasses(direction) {
        if (this.glassesList.length === 0) return;

        let currentIndex = this.glassesList.findIndex(g => g.id === this.currentGlassesId);
        if (currentIndex === -1) {
            currentIndex = 0;
        } else {
            currentIndex += direction;
        }

        // Wrap around
        if (currentIndex < 0) currentIndex = this.glassesList.length - 1;
        if (currentIndex >= this.glassesList.length) currentIndex = 0;

        this.selectGlasses(this.glassesList[currentIndex].id);
    }

    /**
     * Handle window resize.
     * @private
     */
    _onResize() {
        const { width, height } = this.cameraManager.getVideoDimensions();
        if (width > 0 && height > 0) {
            this.glassesRenderer.resize(width, height);
        }
    }

    /**
     * Toggle browser fullscreen mode.
     * @private
     */
    _toggleFullscreen() {
        const appContainer = document.getElementById('app-container') || document.documentElement;

        if (!document.fullscreenElement) {
            const requestFS =
                appContainer.requestFullscreen ||
                appContainer.webkitRequestFullscreen ||
                appContainer.mozRequestFullScreen ||
                appContainer.msRequestFullscreen;

            if (requestFS) {
                requestFS.call(appContainer).catch(err => {
                    console.warn('[App] Fullscreen request failed:', err);
                });
            }
        } else {
            const exitFS =
                document.exitFullscreen ||
                document.webkitExitFullscreen ||
                document.mozCancelFullScreen ||
                document.msExitFullscreen;

            if (exitFS) {
                exitFS.call(document);
            }
        }
    }

    /**
     * Pause the render loop (e.g., when tab is hidden).
     * @private
     */
    _pause() {
        if (!this.isRunning) return;
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        console.log('[App] Paused.');
    }

    /**
     * Resume the render loop.
     * @private
     */
    _resume() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastFpsUpdate = performance.now();
        this.frameCount = 0;
        this.faceTracker.resetSmoothing();
        this._renderLoop();
        console.log('[App] Resumed.');
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Escape HTML special characters to prevent XSS.
     * @param {string} str
     * @returns {string}
     * @private
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Stop the application and release all resources.
     */
    stop() {
        this.isRunning = false;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.cameraManager.stop();
        this.faceTracker.destroy();
        this.glassesRenderer.destroy();

        console.log('[App] Application stopped.');
    }

    /**
     * Get current application state (useful for debugging).
     * @returns {object}
     */
    getState() {
        return {
            isRunning: this.isRunning,
            fps: this.fps,
            currentGlassesId: this.currentGlassesId,
            totalGlasses: this.glassesList.length,
            totalCategories: this.categories.length,
            selectedCategory: this.selectedCategory,
            faceDetected: this.faceTracker.isDetected(),
            cameraRunning: this.cameraManager.isRunning,
            trackerInitialized: this.faceTracker.isInitialized,
            rendererInitialized: this.glassesRenderer.isInitialized,
            hasModel: this.glassesRenderer.hasModel()
        };
    }
}

// ============================================================================
// Auto-initialize on DOM ready
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    window.app = new VirtualTryOnApp();
    window.app.init();
});
