/**
 * GlassesRenderer - Three.js WebGL renderer for 3D glasses overlay.
 * Renders glasses models on a transparent canvas that overlays the webcam video.
 *
 * Requires Three.js loaded from CDN:
 *   <script src="https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/three@0.160/examples/js/loaders/GLTFLoader.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/three@0.160/examples/js/loaders/DRACOLoader.js"></script>
 *
 * Usage:
 *   const renderer = new GlassesRenderer();
 *   renderer.init(canvasElement, videoWidth, videoHeight);
 *   await renderer.loadModel('/api/glasses/1/model', metadata);
 *   // In render loop:
 *   renderer.update(faceData);
 *   renderer.render();
 */
class GlassesRenderer {
    constructor() {
        /** @type {THREE.Scene|null} */
        this.scene = null;
        /** @type {THREE.PerspectiveCamera|null} */
        this.camera = null;
        /** @type {THREE.WebGLRenderer|null} */
        this.renderer = null;
        /** @type {THREE.Object3D|null} */
        this.currentGlasses = null;
        /** @type {THREE.Group|null} */
        this.glassesGroup = null;
        /** @type {THREE.GLTFLoader|null} */
        this.loader = null;
        /** @type {Object.<string, THREE.Object3D>} */
        this.modelCache = {};
        /** @type {boolean} */
        this.isInitialized = false;

        // Current interpolated transform state
        this._currentPosition = { x: 0, y: 0, z: 0 };
        this._currentRotation = { x: 0, y: 0, z: 0 };
        this._currentScale = 0.3; // starts small, lerps up to real scale on first frame

        // Target transform (set from face tracking data)
        this.targetPosition = { x: 0, y: 0, z: 0 };
        this.targetRotation = { x: 0, y: 0, z: 0 };
        this.targetScale = 0.3;

        /** @type {number} Interpolation speed (0-1, higher = faster/less smooth) */
        this.lerpFactor = 0.75;

        // Metadata-based offsets for the current model
        this._modelOffsets = {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        };

        /** @type {boolean} Whether a model is currently loading */
        this._isLoading = false;
    }

    /**
     * Initialize the Three.js scene, camera, renderer, and lighting.
     * @param {HTMLCanvasElement} canvasElement - The canvas to render into
     * @param {number} videoWidth - Video width in pixels
     * @param {number} videoHeight - Video height in pixels
     */
    init(canvasElement, videoWidth, videoHeight) {
        if (!canvasElement || !(canvasElement instanceof HTMLCanvasElement)) {
            throw new Error('A valid HTMLCanvasElement is required for the renderer.');
        }

        if (typeof THREE === 'undefined') {
            throw new Error(
                'Three.js is not loaded. Please include the Three.js script from CDN.'
            );
        }

        // ---- WebGL Renderer ----
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvasElement,
            alpha: true,              // Transparent background
            antialias: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true // Needed for screenshots
        });

        this.renderer.setSize(videoWidth, videoHeight);
        this.renderer.setPixelRatio(1); // keep canvas pixels == video pixels
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.shadowMap.enabled = false;

        // Scale canvas visually to fill the container (same as object-fit:cover on video)
        this._fitCanvasToContainer(canvasElement, videoWidth, videoHeight);

        // ---- Camera (Orthographic — matches NDC landmark coords exactly) ----
        // Space: X in [-aspect, +aspect], Y in [-1, +1], so one unit = half the video height.
        // This is the same convention jeeliz uses and makes landmark→world mapping trivial.
        const aspect = videoWidth / videoHeight;
        this.camera = new THREE.OrthographicCamera(
            -aspect,  // left
             aspect,  // right
             1,       // top
            -1,       // bottom
            0.01,     // near
            100       // far
        );
        this.camera.position.set(0, 0, 10);

        // ---- Scene ----
        this.scene = new THREE.Scene();

        // ---- Lighting ----
        // Ambient for base illumination
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);

        // Main directional light
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(0, 1, 1);
        this.scene.add(dirLight);

        // Hemisphere light for subtle color variation
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
        hemiLight.position.set(0, 1, 0);
        this.scene.add(hemiLight);

        // ---- Glasses Group ----
        this.glassesGroup = new THREE.Group();
        this.glassesGroup.visible = false;
        this.scene.add(this.glassesGroup);

        // ---- GLTF Loader ----
        this._initLoader();

        this.isInitialized = true;
        console.log(`[GlassesRenderer] Initialized: ${videoWidth}x${videoHeight}`);
    }

    /**
     * Initialize the GLTFLoader (and optional DRACOLoader).
     * @private
     */
    _initLoader() {
        if (typeof THREE.GLTFLoader !== 'undefined') {
            this.loader = new THREE.GLTFLoader();

            // Optional: Add DRACO decoder for compressed models
            if (typeof THREE.DRACOLoader !== 'undefined') {
                const dracoLoader = new THREE.DRACOLoader();
                dracoLoader.setDecoderPath(
                    'https://cdn.jsdelivr.net/npm/three@0.160/examples/jsm/libs/draco/'
                );
                this.loader.setDRACOLoader(dracoLoader);
            }
        } else {
            console.warn(
                '[GlassesRenderer] GLTFLoader not found. Model loading will not work. ' +
                'Please include GLTFLoader from Three.js CDN.'
            );
        }
    }

    /**
     * Load a GLB glasses model from URL.
     * @param {string} glbUrl - URL to the GLB model file
     * @param {object} [metadata={}] - Model metadata with transform offsets
     * @returns {Promise<THREE.Object3D>}
     */
    async loadModel(glbUrl, metadata = {}) {
        if (!this.isInitialized) throw new Error('Renderer not initialized. Call init() first.');
        if (!this.loader) throw new Error('GLTFLoader not available.');
        if (this._isLoading) console.warn('[GlassesRenderer] Already loading.');

        this._isLoading = true;
        this._applyMetadataOffsets(metadata);

        try {
            // Always load fresh from network or cache the RAW scene, process after cloning
            let rawScene;
            if (this._rawModelCache && this._rawModelCache[glbUrl]) {
                rawScene = this._rawModelCache[glbUrl];
            } else {
                const gltf = await this._loadGLTF(glbUrl);
                rawScene = gltf.scene;
                if (!this._rawModelCache) this._rawModelCache = {};
                this._rawModelCache[glbUrl] = rawScene;
            }

            // Always process a fresh clone so normalization is applied cleanly
            const model = rawScene.clone();
            this.removeCurrentModel();
            this._processModel(model, metadata);

            this.glassesGroup.add(model);
            this.currentGlasses = model;
            this.glassesGroup.visible = true;

            console.log('[GlassesRenderer] Model loaded successfully.');
            return model;
        } catch (err) {
            console.error('[GlassesRenderer] Failed to load model:', err);
            throw new Error(`Failed to load glasses model: ${err.message}`);
        } finally {
            this._isLoading = false;
        }
    }

    /**
     * Load GLTF/GLB file via the loader (promisified).
     * @param {string} url
     * @returns {Promise<object>} GLTF result
     * @private
     */
    _loadGLTF(url) {
        return new Promise((resolve, reject) => {
            this.loader.load(
                url,
                (gltf) => resolve(gltf),
                (progress) => {
                    if (progress.total > 0) {
                        const pct = ((progress.loaded / progress.total) * 100).toFixed(0);
                        console.log(`[GlassesRenderer] Loading: ${pct}%`);
                    }
                },
                (error) => reject(error)
            );
        });
    }

    /**
     * Apply metadata-based transform offsets.
     * @param {object} metadata
     * @private
     */
    _applyMetadataOffsets(metadata) {
        this._modelOffsets = {
            position: {
                x: parseFloat(metadata.position_offset_x) || 0,
                y: parseFloat(metadata.position_offset_y) || 0,
                z: parseFloat(metadata.position_offset_z) || 0
            },
            rotation: {
                x: parseFloat(metadata.rotation_offset_x) || 0,
                y: parseFloat(metadata.rotation_offset_y) || 0,
                z: parseFloat(metadata.rotation_offset_z) || 0
            },
            scale: {
                x: parseFloat(metadata.scale_x) || 1,
                y: parseFloat(metadata.scale_y) || 1,
                z: parseFloat(metadata.scale_z) || 1
            }
        };
    }

    /**
     * Process a loaded model: normalize size, set up materials, apply metadata offsets.
     * @param {THREE.Object3D} model
     * @param {object} metadata
     * @private
     */
    _processModel(model, metadata) {
        const lensOpacity = metadata.lens_opacity !== undefined ? metadata.lens_opacity : 1.0;

        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                if (child.material) {
                    const materials = Array.isArray(child.material)
                        ? child.material
                        : [child.material];

                    materials.forEach((mat) => {
                        if (mat.map) {
                            mat.map.colorSpace = THREE.SRGBColorSpace;
                        }

                        const nameLower = child.name.toLowerCase();
                        const matNameLower = (mat.name || '').toLowerCase();
                        const isLens =
                            nameLower.includes('lens') ||
                            nameLower.includes('glass') ||
                            nameLower.includes('trans') ||
                            nameLower.includes('mirror') ||
                            matNameLower.includes('lens') ||
                            matNameLower.includes('glass') ||
                            matNameLower.includes('trans') ||
                            matNameLower.includes('mirror');

                        if (isLens && lensOpacity < 1) {
                            mat.transparent = true;
                            mat.opacity = lensOpacity;
                            mat.depthWrite = false;
                            mat.side = THREE.DoubleSide;
                        }

                        if (mat.isMeshStandardMaterial) {
                            mat.envMapIntensity = 1.0;
                            mat.needsUpdate = true;
                        }
                    });
                }
            }
        });

        // 1. Get original bounding box of the raw model
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // 2. Base scale: normalize model so its width (size.x) is exactly 1.0 unit
        let baseScale = 1.0;
        if (size.x > 0) {
            baseScale = 1.0 / size.x;
        }
        model.scale.setScalar(baseScale);

        // 3. Center the model's geometry at (0, 0, 0)
        // Center it horizontally (X) and vertically (Y).
        // For depth (Z), we position the front (box.max.z) at 0 so temples go back (negative Z).
        const offsetX = -center.x * baseScale;
        const offsetY = -center.y * baseScale;
        const offsetZ = -box.max.z * baseScale;
        model.position.set(offsetX, offsetY, offsetZ);

        // 4. Apply metadata adjustments relative to this normalized state.
        // Scale multiplier
        const sx = this._modelOffsets.scale.x;
        const sy = this._modelOffsets.scale.y;
        const sz = this._modelOffsets.scale.z;
        model.scale.multiply(new THREE.Vector3(sx, sy, sz));

        // Position offsets
        const px = this._modelOffsets.position.x;
        const py = this._modelOffsets.position.y;
        const pz = this._modelOffsets.position.z;
        model.position.add(new THREE.Vector3(px, py, pz));

        // Rotation offsets (convert degrees to radians)
        const rxRad = this._modelOffsets.rotation.x * Math.PI / 180;
        const ryRad = this._modelOffsets.rotation.y * Math.PI / 180;
        const rzRad = this._modelOffsets.rotation.z * Math.PI / 180;
        model.rotation.set(rxRad, ryRad, rzRad);
    }

    /**
     * Update glasses position, rotation, and scale from face tracking data.
     * Called every frame.
     * @param {object} faceData - Face data from FaceTracker.getFaceData()
     * @param {boolean} [snap=false] - If true, snaps instantly to face position without lerp
     */
    update(faceData, snap = false) {
        if (!this.isInitialized || !this.glassesGroup) return;

        if (!faceData) {
            this.glassesGroup.visible = false;
            return;
        }

        // Set targets from face tracking data
        this.targetPosition.x = faceData.position.x;
        this.targetPosition.y = faceData.position.y;
        this.targetPosition.z = faceData.position.z;

        this.targetRotation.x = faceData.rotation.x;
        this.targetRotation.y = faceData.rotation.y;
        this.targetRotation.z = faceData.rotation.z;

        this.targetScale = faceData.scale;

        if (snap) {
            // Snaps instantly to targets (prevents slow-sliding/flying effect)
            this._currentPosition.x = this.targetPosition.x;
            this._currentPosition.y = this.targetPosition.y;
            this._currentPosition.z = this.targetPosition.z;

            this._currentRotation.x = this.targetRotation.x;
            this._currentRotation.y = this.targetRotation.y;
            this._currentRotation.z = this.targetRotation.z;

            this._currentScale = this.targetScale;
        } else {
            // Lerp interpolation for smooth movement
            const t = this.lerpFactor;

            this._currentPosition.x = this._lerp(this._currentPosition.x, this.targetPosition.x, t);
            this._currentPosition.y = this._lerp(this._currentPosition.y, this.targetPosition.y, t);
            this._currentPosition.z = this._lerp(this._currentPosition.z, this.targetPosition.z, t);

            this._currentRotation.x = this._lerp(this._currentRotation.x, this.targetRotation.x, t);
            this._currentRotation.y = this._lerp(this._currentRotation.y, this.targetRotation.y, t);
            this._currentRotation.z = this._lerp(this._currentRotation.z, this.targetRotation.z, t);

            this._currentScale = this._lerp(this._currentScale, this.targetScale, t);
        }

        // Apply to the glasses group
        this.glassesGroup.position.set(
            this._currentPosition.x,
            this._currentPosition.y,
            this._currentPosition.z
        );

        this.glassesGroup.rotation.set(
            this._currentRotation.x,
            this._currentRotation.y,
            this._currentRotation.z,
            'XYZ'
        );

        this.glassesGroup.scale.setScalar(this._currentScale);

        // Show glasses
        this.glassesGroup.visible = true;
    }

    /**
     * Render the current scene.
     */
    render() {
        if (!this.isInitialized || !this.renderer || !this.scene || !this.camera) return;
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Set glasses visibility.
     * @param {boolean} visible
     */
    setVisibility(visible) {
        if (this.glassesGroup) {
            this.glassesGroup.visible = visible;
        }
    }

    /**
     * Handle canvas/video resize.
     * @param {number} width - New width
     * @param {number} height - New height
     */
    resize(width, height) {
        if (!this.isInitialized) return;
        const aspect = width / height;
        this.camera.left   = -aspect;
        this.camera.right  =  aspect;
        this.camera.top    =  1;
        this.camera.bottom = -1;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        if (this.renderer.domElement) {
            this._fitCanvasToContainer(this.renderer.domElement, width, height);
        }
        console.log(`[GlassesRenderer] Resized to ${width}x${height}`);
    }

    /**
     * Remove and dispose the currently loaded glasses model.
     */
    removeCurrentModel() {
        if (!this.glassesGroup) return;

        // Remove all children from the group
        while (this.glassesGroup.children.length > 0) {
            const child = this.glassesGroup.children[0];
            this.glassesGroup.remove(child);
            this._disposeObject(child);
        }

        this.currentGlasses = null;
    }

    /**
     * Recursively dispose of an Object3D and its resources.
     * @param {THREE.Object3D} object
     * @private
     */
    _disposeObject(object) {
        if (!object) return;

        object.traverse((child) => {
            if (child.isMesh) {
                // Dispose geometry
                if (child.geometry) {
                    child.geometry.dispose();
                }

                // Dispose materials
                if (child.material) {
                    const materials = Array.isArray(child.material)
                        ? child.material
                        : [child.material];

                    materials.forEach((mat) => {
                        // Dispose textures
                        const textureProps = [
                            'map', 'normalMap', 'roughnessMap', 'metalnessMap',
                            'aoMap', 'emissiveMap', 'alphaMap', 'envMap',
                            'bumpMap', 'displacementMap', 'specularMap'
                        ];

                        textureProps.forEach((prop) => {
                            if (mat[prop]) {
                                mat[prop].dispose();
                            }
                        });

                        mat.dispose();
                    });
                }
            }
        });
    }

    /**
     * Get the renderer's canvas for screenshot compositing.
     * @returns {HTMLCanvasElement}
     */
    captureFrame() {
        if (!this.renderer) {
            throw new Error('Renderer not initialized.');
        }

        // Force a render to ensure the canvas is up-to-date
        this.render();

        return this.renderer.domElement;
    }

    /**
     * Clear the model cache to free memory.
     * @param {string} [url] - Optional specific URL to clear, or clear all if omitted.
     */
    clearCache(url) {
        if (url) {
            if (this.modelCache[url]) {
                this._disposeObject(this.modelCache[url]);
                delete this.modelCache[url];
            }
        } else {
            Object.keys(this.modelCache).forEach((key) => {
                this._disposeObject(this.modelCache[key]);
            });
            this.modelCache = {};
        }
    }

    /**
     * Set the lerp interpolation factor.
     * @param {number} factor - Value between 0 (very smooth/laggy) and 1 (instant/jittery)
     */
    setLerpFactor(factor) {
        this.lerpFactor = Math.max(0.01, Math.min(1.0, factor));
    }

    /**
     * Check if a model is currently loaded.
     * @returns {boolean}
     */
    hasModel() {
        return this.currentGlasses !== null;
    }

    /**
     * Check if a model is currently being loaded.
     * @returns {boolean}
     */
    isLoading() {
        return this._isLoading;
    }

    /**
     * Destroy the renderer and release all resources.
     */
    destroy() {
        // Remove current model
        this.removeCurrentModel();

        // Clear cache
        this.clearCache();

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            this.renderer = null;
        }

        // Clear scene
        if (this.scene) {
            while (this.scene.children.length > 0) {
                const child = this.scene.children[0];
                this.scene.remove(child);
            }
            this.scene = null;
        }

        this.camera = null;
        this.glassesGroup = null;
        this.loader = null;
        this.isInitialized = false;

        console.log('[GlassesRenderer] Destroyed.');
    }

    /**
     * Scale the canvas element visually to fill its container,
     * matching object-fit:cover behaviour of the video element.
     * Three.js renders at video resolution (sharp), CSS transform scales it up.
     * @private
     */
    _fitCanvasToContainer(canvas, vidW, vidH) {
        const container = canvas.parentElement;
        if (!container) return;
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        if (!cw || !ch) return;
        // Cover: scale so the canvas fills the container, centred
        const scaleX = cw / vidW;
        const scaleY = ch / vidH;
        const scale  = Math.max(scaleX, scaleY);
        const offsetX = (cw - vidW * scale) / 2;
        const offsetY = (ch - vidH * scale) / 2;
        // Apply: mirror (scaleX(-1)) + cover scale + centering
        canvas.style.transformOrigin = '0 0';
        canvas.style.transform =
            `translate(${offsetX + vidW * scale}px, ${offsetY}px) scaleX(-${scale}) scaleY(${scale})`;
    }

    /**
     * Linear interpolation between two values.
     * @param {number} a
     * @param {number} b
     * @param {number} t
     * @returns {number}
     * @private
     */
    _lerp(a, b, t) {
        return a + (b - a) * t;
    }
}
