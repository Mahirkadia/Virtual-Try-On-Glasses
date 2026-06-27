/**
 * JewelryRenderer - Three.js WebGL renderer for 3D ring, watch, and bracelet overlays.
 * Renders models on a transparent canvas and matches finger/wrist movement with occlusion.
 *
 * Requires Three.js loaded in context.
 */
class JewelryRenderer {
    constructor() {
        /** @type {THREE.Scene|null} */
        this.scene = null;
        /** @type {THREE.PerspectiveCamera|null} */
        this.camera = null;
        /** @type {THREE.WebGLRenderer|null} */
        this.renderer = null;

        /** @type {THREE.Group|null} */
        this.jewelryGroup = null;
        /** @type {THREE.Mesh|null} */
        this.occlusionMesh = null;
        /** @type {THREE.Object3D|null} */
        this.currentModel = null;

        this.isInitialized = false;
        this.currentType = 'ring'; // 'ring'

        // Lerp states for smoothing tracking gaps
        this._currentPosition = new THREE.Vector3();
        this._currentQuaternion = new THREE.Quaternion();
        this._currentScale = 1.0;
        this.lerpFactor = 0.6; // lower = smoother but laggy, higher = faster

        // Cached models
        this.modelCache = {};
        this._isLoading = false;
        
        // Custom environmental lighting maps (generated procedurally)
        this.pmremGenerator = null;
        this.envMap = null;
    }

    /**
     * Initialize Three.js scene, camera, renderer, lighting, and occlusion geometry.
     */
    init(canvasElement, videoWidth, videoHeight) {
        if (!canvasElement) throw new Error('A canvas element is required.');
        if (typeof THREE === 'undefined') throw new Error('Three.js is not loaded.');

        // 1. WebGL Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvasElement,
            alpha: true,
            antialias: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(videoWidth, videoHeight);
        this.renderer.setPixelRatio(1);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        // Fit canvas to screen (mirroring handled via CSS transforms)
        this._fitCanvasToContainer(canvasElement, videoWidth, videoHeight);

        // 2. Scene
        this.scene = new THREE.Scene();

        // 3. Camera (Orthographic - maps to MediaPipe landmarks perfectly)
        const aspect = videoWidth / videoHeight;
        this.camera = new THREE.OrthographicCamera(
            -aspect,  // left
             aspect,  // right
             1,       // top
            -1,       // bottom
             0.01,    // near
             100      // far
        );
        this.camera.position.set(0, 0, 15);

        // 4. Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight1.position.set(2, 4, 5);
        this.scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xffebcd, 0.4); // warm gold highlight
        dirLight2.position.set(-2, -2, 3);
        this.scene.add(dirLight2);

        // Generate a simple procedural envMap for metal/diamond reflections
        this._generateProceduralEnvMap();

        // 5. Root Group
        this.jewelryGroup = new THREE.Group();
        this.scene.add(this.jewelryGroup);

        this.isInitialized = true;
        console.log(`[JewelryRenderer] Initialized at size ${videoWidth}x${videoHeight}`);
    }

    /**
     * Set try-on item type and recreate corresponding occlusion shape.
     * @param {'ring'} type
     */
    setType(type) {
        this.currentType = type;
        this._recreateOcclusionMesh();
        this._loadDefaultProceduralModel();
    }

    /**
     * Update position, rotation, and scale of the active model and occlusion mesh.
     * @param {object} trackData - Data from HandTracker.getRingData() or getWristData()
     * @param {boolean} [snap=false]
     */
    update(trackData, snap = false) {
        if (!this.isInitialized || !this.jewelryGroup || !trackData) {
            this.jewelryGroup.visible = false;
            return;
        }

        // 1. Position and quaternion from direction vectors or Euler rotation
        const targetPos = new THREE.Vector3(trackData.position.x, trackData.position.y, trackData.position.z);
        
        let targetQuat;
        if (trackData.rotation) {
            const rot = new THREE.Euler(trackData.rotation.x, trackData.rotation.y, trackData.rotation.z, 'XYZ');
            targetQuat = new THREE.Quaternion().setFromEuler(rot);
        } else if (trackData.direction) {
            const m = new THREE.Matrix4();
            const d = trackData.direction;
            m.set(
                d.x.x, d.y.x, d.z.x, 0,
                d.x.y, d.y.y, d.z.y, 0,
                d.x.z, d.y.z, d.z.z, 0,
                0,     0,     0,     1
            );
            targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);
        } else {
            targetQuat = new THREE.Quaternion();
        }
        const targetScale = trackData.scale;

        // 2. Interpolate (lerp) from current state to target state
        if (snap) {
            this._currentPosition.copy(targetPos);
            this._currentQuaternion.copy(targetQuat);
            this._currentScale = targetScale;
        } else {
            const t = this.lerpFactor;
            this._currentPosition.lerp(targetPos, t);
            this._currentQuaternion.slerp(targetQuat, t);
            this._currentScale = this._currentScale + (targetScale - this._currentScale) * t;
        }

        // 3. Apply to Group
        this.jewelryGroup.position.copy(this._currentPosition);
        this.jewelryGroup.quaternion.copy(this._currentQuaternion);
        
        // Scale the entire group (model + centered occlusion mesh scale together)
        this.jewelryGroup.scale.setScalar(this._currentScale);

        this.jewelryGroup.visible = true;
    }

    /**
     * Render the Three.js scene.
     */
    render() {
        if (!this.isInitialized || !this.renderer || !this.scene || !this.camera) return;
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Load a GLB model for the try-on item.
     * If loading fails, it falls back to the default procedural model.
     */
    async loadModel(url, metadata = {}) {
        if (!this.isInitialized) return;
        this._isLoading = true;

        // Remove old model
        this.removeCurrentModel();

        try {
            const loader = new THREE.GLTFLoader();
            
            // Setup Draco decoder if available
            if (typeof THREE.DRACOLoader !== 'undefined') {
                const dracoLoader = new THREE.DRACOLoader();
                dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
                loader.setDRACOLoader(dracoLoader);
            }

            const gltf = await new Promise((resolve, reject) => {
                loader.load(url, resolve, null, reject);
            });

            const model = gltf.scene;

            // Apply realistic PBR materials
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material) {
                        child.material.envMap = this.envMap;
                        child.material.envMapIntensity = 1.5;
                        child.material.needsUpdate = true;
                    }
                }
            });

            // Adjust model alignment relative to our group center
            this._alignGLTFModel(model, metadata);

            this.jewelryGroup.add(model);
            this.currentModel = model;
            console.log(`[JewelryRenderer] Loaded model from ${url}`);
        } catch (err) {
            console.error('[JewelryRenderer] GLTF load failed. Using procedural model.', err);
            this._loadDefaultProceduralModel();
        } finally {
            this._isLoading = false;
        }
    }

    /**
     * Hide jewelry group (e.g. when tracking is lost).
     */
    setVisibility(visible) {
        if (this.jewelryGroup) {
            this.jewelryGroup.visible = visible;
        }
    }

    /**
     * Handle canvas resize.
     */
    resize(width, height) {
        if (!this.isInitialized) return;
        const aspect = width / height;
        this.camera.left = -aspect;
        this.camera.right = aspect;
        this.camera.top = 1;
        this.camera.bottom = -1;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this._fitCanvasToContainer(this.renderer.domElement, width, height);
    }

    /**
     * Capture frame for sharing.
     */
    captureFrame() {
        this.render();
        return this.renderer.domElement;
    }

    /**
     * Clean up resources.
     */
    destroy() {
        this.removeCurrentModel();
        if (this.occlusionMesh) {
            this.jewelryGroup.remove(this.occlusionMesh);
            this.occlusionMesh.geometry.dispose();
            this.occlusionMesh.material.dispose();
            this.occlusionMesh = null;
        }
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            this.renderer = null;
        }
        this.isInitialized = false;
        console.log('[JewelryRenderer] Destroyed.');
    }

    removeCurrentModel() {
        if (this.currentModel) {
            this.jewelryGroup.remove(this.currentModel);
            this._disposeObject(this.currentModel);
            this.currentModel = null;
        }
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Recreates the invisible cylinder mesh used to hide the back parts of the models.
     * @private
     */
    _recreateOcclusionMesh() {
        if (this.occlusionMesh) {
            this.jewelryGroup.remove(this.occlusionMesh);
            this.occlusionMesh.geometry.dispose();
            this.occlusionMesh.material.dispose();
            this.occlusionMesh = null;
        }

        // Create cylinder with exact fitting dimensions relative to model scale 1.0 (ring finger)
        const radius = 0.28; // Reduced slightly to prevent ring-face clipping
        const height = 3.0;  // Long enough to cover the finger segment
        const offsetZ = 0;

        const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
        
        // Depth-only material: invisible but writes to depth buffer.
        // This is the core VTO trick.
        const material = new THREE.MeshBasicMaterial({
            color: 0x000000,
            colorWrite: false, // Make invisible
            depthWrite: true   // Block things behind it
        });

        this.occlusionMesh = new THREE.Mesh(geometry, material);
        
        // Position the occlusion mesh
        this.occlusionMesh.position.set(0, 0, offsetZ);
        this.occlusionMesh.renderOrder = 1; // Render occlusion cylinder first

        this.jewelryGroup.add(this.occlusionMesh);
    }

    /**
     * Create high-fidelity procedural 3D models when no model is loaded.
     * Allows instant visual testing.
     * @private
     */
    _loadDefaultProceduralModel() {
        this.removeCurrentModel();

        const modelGroup = new THREE.Group();

        if (this.currentType === 'ring') {
            // ---- GOLD GEMSTONE RING ----
            // 1. Ring Band (Torus)
            // A standard torus lies in XY plane. We rotate it so it sits flat around the finger.
            const bandGeom = new THREE.TorusGeometry(0.55, 0.08, 16, 64);
            const bandMat = new THREE.MeshStandardMaterial({
                color: 0xffdf00, // Gold
                metalness: 1.0,
                roughness: 0.15,
                envMap: this.envMap,
                envMapIntensity: 1.5
            });
            const band = new THREE.Mesh(bandGeom, bandMat);
            band.rotation.x = Math.PI / 2; // Lie flat around finger (XZ plane)
            modelGroup.add(band);

            // 2. Crown / Gemstone setting
            const gemSettingGeom = new THREE.CylinderGeometry(0.12, 0.08, 0.15, 8);
            const gemSetting = new THREE.Mesh(gemSettingGeom, bandMat);
            gemSetting.position.set(0, 0, 0.58);
            gemSetting.rotation.x = Math.PI / 2;
            modelGroup.add(gemSetting);

            // 3. Central Gemstone (Refractive cut Octahedron)
            const gemGeom = new THREE.OctahedronGeometry(0.14);
            const gemMat = new THREE.MeshPhysicalMaterial({
                color: 0x00ffff, // Sparkling diamond blue
                metalness: 0.0,
                roughness: 0.0,
                transmission: 0.95,
                ior: 2.4, // Refraction index of diamond
                thickness: 0.5,
                envMap: this.envMap,
                envMapIntensity: 2.0
            });
            const gem = new THREE.Mesh(gemGeom, gemMat);
            gem.position.set(0, 0, 0.67);
            gem.rotation.y = Math.PI / 4;
            modelGroup.add(gem);

            // 4. Small side accent gems (Green/Pink gemstones)
            const sideGemGeom = new THREE.SphereGeometry(0.05, 8, 8);
            const pinkGemMat = new THREE.MeshPhysicalMaterial({
                color: 0xff1493, // Pink
                roughness: 0.0,
                transmission: 0.9,
                ior: 1.77, // Sapphire
                thickness: 0.2,
                envMap: this.envMap
            });
            
            const sideL = new THREE.Mesh(sideGemGeom, pinkGemMat);
            sideL.position.set(-0.16, 0.08, 0.54);
            modelGroup.add(sideL);

            const sideR = new THREE.Mesh(sideGemGeom, pinkGemMat);
            sideR.position.set(0.16, -0.08, 0.54);
            modelGroup.add(sideR);

        }

        modelGroup.renderOrder = 2; // Render after the occlusion mask cylinder
        this.jewelryGroup.add(modelGroup);
        this.currentModel = modelGroup;
    }

    /**
     * Scale and center GLTF models to match the procedural model scale.
     *
     * The procedural ring torus has outer diameter ≈ 1.26 units (radius 0.55 + thickness 0.08).
     * The tracker scale drives the group's scale.setScalar(), so the model's internal size
     * must match the procedural model exactly — otherwise it appears too small or too large.
     *
    /**
     * Align a loaded GLTF ring model to match the tracker coordinate system.
     *
     * TRACKER COORDINATE SYSTEM (from HandTracker):
     *   Y-axis = along the finger (MCP → PIP direction)
     *   Z-axis = out of the back of the hand
     *   X-axis = sideways across the finger
     *
     * So the ring hole must align with Y (finger goes through the ring along Y).
     *
     * Most ring GLBs are exported with the hole along Z (Blender default).
     * We detect the hole axis by finding the SMALLEST bounding dimension,
     * then rotate so that axis aligns with Y.
     *
     * Scale: normalize so the ring band diameter = 1.26 units
     * (matches the procedural torus: radius 0.55 + thickness 0.08 = outer r 0.63, dia 1.26)
     * @private
     */
    _alignGLTFModel(model, metadata) {
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // ── 1. Detect hole axis ─────────────────────────────────────────────
        // The ring hole is along the SMALLEST bounding dimension.
        // (A ring is thin along its hole axis, wide along its diameter)
        let holeAxis = 'z'; // default: most GLB exporters use Z
        if (size.x <= size.y && size.x <= size.z) holeAxis = 'x';
        else if (size.y <= size.x && size.y <= size.z) holeAxis = 'y';
        else holeAxis = 'z';

        // ── 2. Scale: normalize diameter to target units ─────────────────
        // Diameter = average of the two dimensions that are NOT the hole axis.
        let d1, d2;
        if (holeAxis === 'x')      { d1 = size.y; d2 = size.z; }
        else if (holeAxis === 'y') { d1 = size.x; d2 = size.z; }
        else                       { d1 = size.x; d2 = size.y; }

        const ringDiameter = (d1 + d2) / 2;
        const TARGET_DIAMETER = 1.26;
        const baseScale = ringDiameter > 0 ? TARGET_DIAMETER / ringDiameter : 1.0;

        model.scale.setScalar(baseScale);

        // ── 3. Center at origin ─────────────────────────────────────────────
        model.position.set(
            -center.x * baseScale,
            -center.y * baseScale,
            -center.z * baseScale
        );

        // ── 4. Rotate hole axis → Y axis (finger direction) ─────────────────
        // Tracker Y = along finger. Hole must be along Y so finger passes through.
        let autoRx = 0, autoRy = 0, autoRz = 0;
        if (holeAxis === 'x') {
            // X→Y: rotate -90° around Z
            autoRz = -Math.PI / 2;
        } else if (holeAxis === 'z') {
            // Z→Y: rotate +90° around X
            autoRx = Math.PI / 2;
        }

        // ── 5. Apply metadata overrides on top of auto-alignment ────────────
        const sx = parseFloat(metadata.scale_x) || 1;
        const sy = parseFloat(metadata.scale_y) || 1;
        const sz = parseFloat(metadata.scale_z) || 1;
        model.scale.set(baseScale * sx, baseScale * sy, baseScale * sz);

        const qAuto = new THREE.Quaternion().setFromEuler(new THREE.Euler(autoRx, autoRy, autoRz, 'XYZ'));
        const rx = (parseFloat(metadata.rotation_offset_x) || 0) * Math.PI / 180;
        const ry = (parseFloat(metadata.rotation_offset_y) || 0) * Math.PI / 180;
        const rz = (parseFloat(metadata.rotation_offset_z) || 0) * Math.PI / 180;
        const qMeta = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
        model.quaternion.copy(qAuto.multiply(qMeta));

        const px = parseFloat(metadata.position_offset_x) || 0;
        const py = parseFloat(metadata.position_offset_y) || 0;
        const pz = parseFloat(metadata.position_offset_z) || 0;
        model.position.set(
            -center.x * baseScale + px,
            -center.y * baseScale + py,
            -center.z * baseScale + pz
        );

        model.renderOrder = 2;

        console.log(`[JewelryRenderer] GLB aligned — holeAxis:${holeAxis}, size:${size.x.toFixed(3)}x${size.y.toFixed(3)}x${size.z.toFixed(3)}, baseScale:${baseScale.toFixed(4)}`);
    }

    /**
     * Generates a procedural environment map to create photorealistic metallic reflections.
     * @private
     */
    _generateProceduralEnvMap() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Sky gradient
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, '#555555');
        grad.addColorStop(0.4, '#222222');
        grad.addColorStop(0.5, '#050505');
        grad.addColorStop(0.6, '#333333');
        grad.addColorStop(1, '#666666');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Vertical softboxes
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(80, 20, 40, canvas.height - 40);
        ctx.fillRect(320, 20, 60, canvas.height - 40);
        
        // Overhead glow
        const radial = ctx.createRadialGradient(256, 128, 10, 256, 128, 100);
        radial.addColorStop(0, '#ffffff');
        radial.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = radial;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        this.envMap = texture;
    }

    _fitCanvasToContainer(canvas, vidW, vidH) {
        const container = canvas.parentElement;
        if (!container) return;
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        if (!cw || !ch) return;

        const scaleX = cw / vidW;
        const scaleY = ch / vidH;
        const scale = Math.max(scaleX, scaleY);
        const offsetX = (cw - vidW * scale) / 2;
        const offsetY = (ch - vidH * scale) / 2;

        canvas.style.transformOrigin = '0 0';
        canvas.style.transform = `translate(${offsetX + vidW * scale}px, ${offsetY}px) scaleX(-${scale}) scaleY(${scale})`;
    }

    _disposeObject(object) {
        if (!object) return;
        object.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => m.dispose());
                }
            }
        });
    }
}
