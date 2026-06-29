/**
 * HeadphonesRenderer - Three.js WebGL renderer for 3D headphones and earbuds.
 * Aligns models automatically based on ear coordinates, head size, and head rotation.
 * Incorporates a 3D head occlusion mesh for photorealistic rendering when turning.
 */
class HeadphonesRenderer {
    constructor() {
        /** @type {THREE.Scene|null} */
        this.scene = null;
        /** @type {THREE.PerspectiveCamera|null} */
        this.camera = null;
        /** @type {THREE.WebGLRenderer|null} */
        this.renderer = null;

        /** @type {THREE.Group|null} */
        this.headphonesGroup = null;
        /** @type {THREE.Group|null} */
        this.occlusionGroup = null;
        /** @type {THREE.Object3D|null} */
        this.currentModel = null;
        /** @type {THREE.Object3D|null} */
        this.leftEarbudModel = null;
        /** @type {THREE.Object3D|null} */
        this.rightEarbudModel = null;

        this.isInitialized = false;
        this.currentCategory = 'headphone'; // 'headphone' or 'earbud'

        // Lerp states for smoothing tracking gaps
        this._currentPosition = new THREE.Vector3();
        this._currentQuaternion = new THREE.Quaternion();
        this._currentScale = 1.0;
        this.lerpFactor = 0.75; // higher = faster/less smooth, lower = smoother/laggy

        // Model cache
        this.modelCache = {};
        this._isLoading = false;

        // Environmental lighting map
        this.envMap = null;

        // Metadata adjustments for the current model
        this._metadata = {
            scale_x: 1, scale_y: 1, scale_z: 1,
            position_offset_x: 0, position_offset_y: 0, position_offset_z: 0,
            rotation_offset_x: 0, rotation_offset_y: 0, rotation_offset_z: 0
        };
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

        // Fit canvas to container (mirroring handled via CSS transforms)
        this._fitCanvasToContainer(canvasElement, videoWidth, videoHeight);

        // 2. Scene
        this.scene = new THREE.Scene();

        // 3. Camera (Orthographic - maps to MediaPipe landmarks with pixel-perfect precision)
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

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.9);
        dirLight1.position.set(0, 5, 5);
        this.scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xaaccff, 0.5); // cool fill light
        dirLight2.position.set(-3, -3, 3);
        this.scene.add(dirLight2);

        // Generate procedural reflection envMap
        this._generateProceduralEnvMap();

        // 5. Root Groups
        // Head occlusion group (rendered first to write to depth buffer)
        this.occlusionGroup = new THREE.Group();
        this.scene.add(this.occlusionGroup);
        this._recreateOcclusionMesh();

        // Headphones group (rendered on top of occlusion)
        this.headphonesGroup = new THREE.Group();
        this.scene.add(this.headphonesGroup);

        this.isInitialized = true;
        console.log(`[HeadphonesRenderer] Initialized at size ${videoWidth}x${videoHeight}`);
    }

    /**
     * Set try-on category (headphone or earbud)
     * @param {'headphone'|'earbud'} category
     */
    setCategory(category) {
        if (category !== 'headphone' && category !== 'earbud') return;
        this.currentCategory = category;
        this.removeCurrentModel();
        this._loadDefaultProceduralModel();
    }

    /**
     * Update position, rotation, and scale of the active model and occlusion mesh.
     * @param {object} faceData - Data from FaceTracker.getFaceData() or getEarringsData()
     * @param {boolean} [snap=false]
     */
    update(faceData, snap = false) {
        if (!this.isInitialized || !this.headphonesGroup || !faceData) {
            if (this.headphonesGroup) this.headphonesGroup.visible = false;
            if (this.occlusionGroup) this.occlusionGroup.visible = false;
            return;
        }

        const lm = faceData.landmarks;
        if (!lm || !lm.leftEar || !lm.rightEar || !lm.forehead || !lm.chin) {
            if (this.headphonesGroup) this.headphonesGroup.visible = false;
            if (this.occlusionGroup) this.occlusionGroup.visible = false;
            return;
        }

        const aspect = faceData.videoWidth / faceData.videoHeight;

        // ── Convert normalized MediaPipe landmarks → Orthographic world coords ──
        const toWorld = (landmark) => new THREE.Vector3(
            (landmark.x - 0.5) * 2.0 * aspect,
            -(landmark.y - 0.5) * 2.0,
            -landmark.z * 2.0 * aspect
        );

        const leftEarW   = toWorld(lm.leftEar);
        const rightEarW  = toWorld(lm.rightEar);
        const foreheadW  = toWorld(lm.forehead);
        const chinW      = toWorld(lm.chin);
        const noseBridgeW = toWorld(lm.noseBridge);

        // ══════════════════════════════════════════════════════════════════════
        // 1. SCALE — Based on face HEIGHT (stable across head rotations)
        //    When turning your head, ear-to-ear shrinks dramatically but
        //    forehead-to-chin barely changes. This keeps headphone size stable.
        // ══════════════════════════════════════════════════════════════════════
        const faceHeight = foreheadW.distanceTo(chinW);
        const targetScale = faceHeight * 1.10;

        // ══════════════════════════════════════════════════════════════════════
        // 2. POSITION — Ear-canal-level Y, ear-midpoint X/Z
        //    Ear canal is between eye level (nose bridge) and MediaPipe ear
        //    landmark (which is on the tragus/cheekbone, below the canal).
        //    Blend: 40% nose bridge + 60% ear midpoint gives canal height.
        // ══════════════════════════════════════════════════════════════════════
        const earMidY = (leftEarW.y + rightEarW.y) * 0.5;
        const earCanalY = noseBridgeW.y * 0.40 + earMidY * 0.60; // Blend to bring it up from the jawline

        const targetPos = new THREE.Vector3(
            (leftEarW.x + rightEarW.x) * 0.5,
            earCanalY + 0.10 * targetScale,  // Push UP so headband clears the forehead and sits on the hair
            (leftEarW.z + rightEarW.z) * 0.5
        );

        // ══════════════════════════════════════════════════════════════════════
        // 3. ROTATION — Geometric rotation from 3D landmarks (mathematically stable)
        // ══════════════════════════════════════════════════════════════════════
        // Create orthogonal basis vectors for the head's rotation
        const xAxis = new THREE.Vector3().subVectors(leftEarW, rightEarW).normalize();
        let yAxis = new THREE.Vector3().subVectors(foreheadW, chinW).normalize();
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
        yAxis.crossVectors(zAxis, xAxis).normalize(); // Ensure perfectly orthogonal

        const rotMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const targetQuat = new THREE.Quaternion().setFromRotationMatrix(rotMat);

        // ══════════════════════════════════════════════════════════════════════
        // 4. LERP SMOOTHING — Eliminates jitter
        // ══════════════════════════════════════════════════════════════════════
        if (snap) {
            this._currentPosition.copy(targetPos);
            this._currentQuaternion.copy(targetQuat);
            this._currentScale = targetScale;
        } else {
            const t = this.lerpFactor;
            this._currentPosition.lerp(targetPos, t);
            this._currentQuaternion.slerp(targetQuat, t);
            this._currentScale += (targetScale - this._currentScale) * t;
        }

        // ══════════════════════════════════════════════════════════════════════
        // 5. APPLY TRANSFORMS
        // ══════════════════════════════════════════════════════════════════════
        this.headphonesGroup.position.copy(this._currentPosition);
        this.headphonesGroup.quaternion.copy(this._currentQuaternion);
        this.headphonesGroup.scale.setScalar(this._currentScale);

        this.occlusionGroup.position.copy(this._currentPosition);
        this.occlusionGroup.quaternion.copy(this._currentQuaternion);
        this.occlusionGroup.scale.setScalar(this._currentScale);

        if (this.currentCategory === 'headphone') {
            if (this.leftEarbudModel) this.leftEarbudModel.visible = false;
            if (this.rightEarbudModel) this.rightEarbudModel.visible = false;
            if (this.currentModel) this.currentModel.visible = true;

        } else if (this.currentCategory === 'earbud') {
            // Position earbuds at ear canal locations (in local group space)
            const leftCanal  = new THREE.Vector3(leftEarW.x,  earCanalY, leftEarW.z);
            const rightCanal = new THREE.Vector3(rightEarW.x, earCanalY, rightEarW.z);

            const relativeLeft = new THREE.Vector3().subVectors(leftCanal, this._currentPosition)
                .applyQuaternion(this._currentQuaternion.clone().invert())
                .multiplyScalar(1 / this._currentScale);
            const relativeRight = new THREE.Vector3().subVectors(rightCanal, this._currentPosition)
                .applyQuaternion(this._currentQuaternion.clone().invert())
                .multiplyScalar(1 / this._currentScale);

            if (this.leftEarbudModel && this.rightEarbudModel) {
                this.leftEarbudModel.position.copy(relativeLeft);
                this.rightEarbudModel.position.copy(relativeRight);
                this.leftEarbudModel.visible = true;
                this.rightEarbudModel.visible = true;
                if (this.currentModel) this.currentModel.visible = false;
            }
        }

        this.headphonesGroup.visible = true;
        this.occlusionGroup.visible = true;
    }

    /**
     * Render the Three.js scene.
     */
    render() {
        if (!this.isInitialized || !this.renderer || !this.scene || !this.camera) return;
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Load a GLB model for headphones or earbuds.
     */
    async loadModel(url, metadata = {}) {
        if (!this.isInitialized) return;
        this._isLoading = true;
        this._metadata = metadata;

        this.removeCurrentModel();

        try {
            const loader = new THREE.GLTFLoader();
            if (typeof THREE.DRACOLoader !== 'undefined') {
                const dracoLoader = new THREE.DRACOLoader();
                dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
                loader.setDRACOLoader(dracoLoader);
            }

            const gltf = await new Promise((resolve, reject) => {
                loader.load(url, resolve, null, reject);
            });

            const model = gltf.scene;

            // Setup meshes and materials without washing out original textures/colors
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(mat => {
                            // Ensure color spaces are correct for standard textures
                            if (mat.map) {
                                mat.map.colorSpace = THREE.SRGBColorSpace;
                            }
                            if (mat.emissiveMap) {
                                mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                            }
                            // Assign environment reflections gently if supported and not already set
                            if (mat.isMeshStandardMaterial && !mat.envMap) {
                                mat.envMap = this.envMap;
                                mat.envMapIntensity = 0.5; // low intensity fill reflection
                            }
                            mat.needsUpdate = true;
                        });
                    }
                }
            });

            // Adjust model scaling, centering and offsets
            this._alignGLTFModel(model, metadata);

            this.currentModel = model;
            this.headphonesGroup.add(model);

            // If it's an earbud, clone it for both left and right ears
            if (this.currentCategory === 'earbud') {
                this.leftEarbudModel = model.clone();
                this.rightEarbudModel = model.clone();

                // Mirror the right earbud along X so it points correctly into the right ear
                this.rightEarbudModel.scale.x *= -1;

                this.headphonesGroup.add(this.leftEarbudModel);
                this.headphonesGroup.add(this.rightEarbudModel);

                // Hide the main single model since we display the left/right clones
                this.currentModel.visible = false;
            }

            console.log(`[HeadphonesRenderer] Loaded model from ${url} as ${this.currentCategory}`);
        } catch (err) {
            console.error('[HeadphonesRenderer] GLTF load failed. Using procedural fallback.', err);
            this._loadDefaultProceduralModel();
        } finally {
            this._isLoading = false;
        }
    }

    /**
     * Hide headphones group
     */
    setVisibility(visible) {
        if (this.headphonesGroup) {
            this.headphonesGroup.visible = visible;
        }
        if (this.occlusionGroup) {
            this.occlusionGroup.visible = visible;
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
        if (this.occlusionGroup) {
            while (this.occlusionGroup.children.length > 0) {
                const child = this.occlusionGroup.children[0];
                this.occlusionGroup.remove(child);
                child.geometry.dispose();
                child.material.dispose();
            }
            this.scene.remove(this.occlusionGroup);
            this.occlusionGroup = null;
        }
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            this.renderer = null;
        }
        this.isInitialized = false;
        console.log('[HeadphonesRenderer] Destroyed.');
    }

    removeCurrentModel() {
        if (this.currentModel) {
            this.headphonesGroup.remove(this.currentModel);
            this._disposeObject(this.currentModel);
            this.currentModel = null;
        }
        if (this.leftEarbudModel) {
            this.headphonesGroup.remove(this.leftEarbudModel);
            this._disposeObject(this.leftEarbudModel);
            this.leftEarbudModel = null;
        }
        if (this.rightEarbudModel) {
            this.headphonesGroup.remove(this.rightEarbudModel);
            this._disposeObject(this.rightEarbudModel);
            this.rightEarbudModel = null;
        }
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Creates invisible head-shape meshes that write only to depth buffer.
     * This creates a mask to occlude headphone parts behind the head/ears.
     * @private
     */
    _recreateOcclusionMesh() {
        // Skull: Small sphere representing only the back-of-head volume.
        // Radius kept small (0.28) so it never clips earcups or face.
        const skullGeo = new THREE.SphereGeometry(0.28, 32, 32);

        // Jaw/neck cylinder — narrow (0.25) to avoid overlapping with bottom of cups.
        const jawGeo = new THREE.CylinderGeometry(0.25, 0.22, 0.8, 32);

        const occMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            colorWrite: false, // Invisible
            depthWrite: true   // Write depth values to block colors rendered behind
        });

        const skullMesh = new THREE.Mesh(skullGeo, occMat);
        skullMesh.position.set(0, 0.08, -0.25);

        const jawMesh = new THREE.Mesh(jawGeo, occMat);
        jawMesh.position.set(0, -0.3, -0.22);

        this.occlusionGroup.add(skullMesh);
        this.occlusionGroup.add(jawMesh);
    }

    /**
     * Renders high-quality procedural fallback models for instant testing.
     * @private
     */
    _loadDefaultProceduralModel() {
        this.removeCurrentModel();

        const modelGroup = new THREE.Group();

        if (this.currentCategory === 'headphone') {
            // ═══════════════════════════════════════════════════════════════
            // PROCEDURAL HEADPHONES — Correctly proportioned for face fit
            //
            // Design principle: The model is built in "normalized" space where
            // total visual width (including earcup outer edges) = 1.0 unit.
            // At runtime, scale = faceHeight * 0.58, so on a typical face
            // (~0.55 units tall), the headphones are ~0.32 units wide,
            // which is slightly narrower than face width (~0.36 units).
            // This ensures earcups sit ON the ears, not beyond them.
            // ═══════════════════════════════════════════════════════════════

            const metalMat = new THREE.MeshStandardMaterial({
                color: 0x888888,
                metalness: 0.9,
                roughness: 0.15,
                envMap: this.envMap,
                envMapIntensity: 1.5
            });

            const matteMat = new THREE.MeshStandardMaterial({
                color: 0x18181a,
                metalness: 0.1,
                roughness: 0.5
            });

            const cushionMat = new THREE.MeshStandardMaterial({
                color: 0x2e2e30,
                metalness: 0.05,
                roughness: 0.7
            });

            // ── 1. Headband (Half Torus) ──────────────────────────────────
            // Earcup centers at ±0.42, so headband radius = 0.42
            // Total visual width = 0.42*2 + 0.08*2 = 1.0 (matching norm)
            const bandGeom = new THREE.TorusGeometry(0.42, 0.018, 16, 64, Math.PI);
            const headband = new THREE.Mesh(bandGeom, matteMat);
            headband.rotation.z = Math.PI; // arch upward
            headband.scale.set(1.0, 1.35, 1.0); // stretch vertically to clear top of head
            modelGroup.add(headband);

            // ── 2. Left Earcup ────────────────────────────────────────────
            const leftCupGroup = new THREE.Group();
            leftCupGroup.position.set(0.42, 0, 0);

            const cupOuterGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.035, 32);
            const cupOuterL = new THREE.Mesh(cupOuterGeom, metalMat);
            cupOuterL.rotation.z = -Math.PI / 2;
            leftCupGroup.add(cupOuterL);

            const cushionGeom = new THREE.CylinderGeometry(0.078, 0.078, 0.025, 32);
            const cushionL = new THREE.Mesh(cushionGeom, cushionMat);
            cushionL.rotation.z = -Math.PI / 2;
            cushionL.position.x = -0.028;
            leftCupGroup.add(cushionL);

            const jointGeom = new THREE.SphereGeometry(0.016, 16, 16);
            const jointL = new THREE.Mesh(jointGeom, metalMat);
            jointL.position.set(0.0, 0.042, 0.0);
            leftCupGroup.add(jointL);

            modelGroup.add(leftCupGroup);

            // ── 3. Right Earcup ───────────────────────────────────────────
            const rightCupGroup = new THREE.Group();
            rightCupGroup.position.set(-0.42, 0, 0);

            const cupOuterR = new THREE.Mesh(cupOuterGeom, metalMat);
            cupOuterR.rotation.z = Math.PI / 2;
            rightCupGroup.add(cupOuterR);

            const cushionR = new THREE.Mesh(cushionGeom, cushionMat);
            cushionR.rotation.z = Math.PI / 2;
            cushionR.position.x = 0.028;
            rightCupGroup.add(cushionR);

            const jointR = new THREE.Mesh(jointGeom, metalMat);
            jointR.position.set(0.0, 0.042, 0.0);
            rightCupGroup.add(jointR);

            modelGroup.add(rightCupGroup);

            modelGroup.renderOrder = 2;
            this.headphonesGroup.add(modelGroup);
            this.currentModel = modelGroup;

        } else if (this.currentCategory === 'earbud') {
            // ---- PROCEDURAL EARBUDS ----
            // Glossy ceramic look
            const whiteCeramic = new THREE.MeshStandardMaterial({
                color: 0xf0f0f5,
                metalness: 0.1,
                roughness: 0.05,
                envMap: this.envMap,
                envMapIntensity: 1.8
            });

            const tipMat = new THREE.MeshStandardMaterial({
                color: 0xa0a5b5,
                metalness: 0.0,
                roughness: 0.3,
                transparent: true,
                opacity: 0.8
            });

            const metallicDetail = new THREE.MeshStandardMaterial({
                color: 0xc0c5d5,
                metalness: 0.9,
                roughness: 0.1,
                envMap: this.envMap
            });

            // Earbud base geometry
            // 1. Left Earbud
            const earbudL = new THREE.Group();
            
            // Earbud body
            const bodyGeo = new THREE.SphereGeometry(0.045, 16, 16);
            const bodyL = new THREE.Mesh(bodyGeo, whiteCeramic);
            bodyL.scale.set(1.2, 1, 1);
            earbudL.add(bodyL);

            // Silicone ear tip (pointing inward along X)
            const tipGeo = new THREE.CylinderGeometry(0.024, 0.036, 0.025, 16);
            const tipL = new THREE.Mesh(tipGeo, tipMat);
            tipL.rotation.z = Math.PI / 2;
            tipL.position.set(0.035, -0.01, 0); // shift inward towards ear canal
            earbudL.add(tipL);

            // Small stalk
            const stalkGeo = new THREE.CylinderGeometry(0.012, 0.009, 0.065, 16);
            const stalkL = new THREE.Mesh(stalkGeo, whiteCeramic);
            stalkL.position.set(-0.015, -0.045, 0.01);
            stalkL.rotation.z = -Math.PI / 6;
            earbudL.add(stalkL);

            // Charging contact metal plate
            const plateGeo = new THREE.CylinderGeometry(0.010, 0.010, 0.004, 16);
            const plateL = new THREE.Mesh(plateGeo, metallicDetail);
            plateL.position.set(-0.028, -0.075, 0.012);
            plateL.rotation.z = -Math.PI / 6;
            earbudL.add(plateL);

            this.leftEarbudModel = earbudL;
            this.headphonesGroup.add(earbudL);

            // 2. Right Earbud (Mirrored clone)
            const earbudR = earbudL.clone();
            
            // Mirror position of tip and rotate stalk
            // We set scale.x to negative to completely mirror it
            earbudR.scale.x = -1;

            this.rightEarbudModel = earbudR;
            this.headphonesGroup.add(earbudR);

            // Make single main model container invisible
            const mainContainer = new THREE.Group();
            this.headphonesGroup.add(mainContainer);
            this.currentModel = mainContainer;
            this.currentModel.visible = false;
        }
    }

    /**
     * Automatically scales and aligns loaded GLTF models to standard VTO bounds.
     * @private
     */
    _alignGLTFModel(model, metadata) {
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // ═══════════════════════════════════════════════════════════════
        // Normalize GLB model so it fits within the face-height-based
        // scale system. The model's HEIGHT is normalized to 0.80 units
        // (instead of width). This keeps earcups at their designed
        // proportional size regardless of model width.
        // ═══════════════════════════════════════════════════════════════
        let baseScale = 1.0;
        let earcupY = center.y;

        if (this.currentCategory === 'headphone') {
            // Normalize by WIDTH to match procedural model (width = 1.0 unit)
            if (size.x > 0) {
                baseScale = 1.0 / size.x;
            }

            // Vertex analysis: find the vertical center of the earcup regions
            // (the outer 16% of the model width where the cups sit)
            let ySum = 0;
            let yCount = 0;

            model.traverse((child) => {
                if (child.isMesh && child.geometry) {
                    const posAttr = child.geometry.attributes.position;
                    if (posAttr) {
                        child.updateMatrixWorld(true);
                        const matrix = child.matrixWorld;
                        const step = Math.max(1, Math.floor(posAttr.count / 1000));
                        const v = new THREE.Vector3();

                        for (let i = 0; i < posAttr.count; i += step) {
                            v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                            v.applyMatrix4(matrix);
                            if (Math.abs(v.x - center.x) > size.x * 0.42) {
                                ySum += v.y;
                                yCount++;
                            }
                        }
                    }
                }
            });

            if (yCount > 0) {
                earcupY = ySum / yCount;
                console.log(`[HeadphonesRenderer] Auto-detected earcup center Y: ${earcupY.toFixed(4)}`);
            }
        } else {
            // For earbuds, normalize to 0.10 units (small enough to fit in ear)
            const maxDimension = Math.max(size.x, size.y, size.z);
            if (maxDimension > 0) {
                baseScale = 0.10 / maxDimension;
            }
        }

        model.scale.setScalar(baseScale);

        // Center model so earcup midpoint is at Y=0 (group origin)
        model.position.set(
            -center.x * baseScale,
            -earcupY * baseScale,
            -center.z * baseScale
        );

        // Apply metadata overrides (scale, offset, rotation)
        const sx = parseFloat(metadata.scale_x) || 1;
        const sy = parseFloat(metadata.scale_y) || 1;
        const sz = parseFloat(metadata.scale_z) || 1;
        model.scale.multiply(new THREE.Vector3(sx, sy, sz));

        const px = parseFloat(metadata.position_offset_x) || 0;
        const py = parseFloat(metadata.position_offset_y) || 0;
        const pz = parseFloat(metadata.position_offset_z) || 0;
        model.position.add(new THREE.Vector3(px, py, pz));

        const rx = (parseFloat(metadata.rotation_offset_x) || 0) * Math.PI / 180;
        const ry = (parseFloat(metadata.rotation_offset_y) || 0) * Math.PI / 180;
        const rz = (parseFloat(metadata.rotation_offset_z) || 0) * Math.PI / 180;
        model.rotation.set(rx, ry, rz);

        model.renderOrder = 2;

        console.log(`[HeadphonesRenderer] Aligned GLB: baseScale=${baseScale.toFixed(4)}, size=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`);
    }

    /**
     * Procedural environment texture for high-fidelity metal/plastic reflections.
     * @private
     */
    _generateProceduralEnvMap() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Dark sky / ground gradient
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, '#3a3d45');
        grad.addColorStop(0.4, '#1b1c1e');
        grad.addColorStop(0.5, '#0a0a0d');
        grad.addColorStop(0.6, '#202226');
        grad.addColorStop(1, '#484c56');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Softbox lights (simulating studio environment)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(60, 20, 50, canvas.height - 40);
        ctx.fillRect(340, 20, 70, canvas.height - 40);

        // Circular glow
        const radial = ctx.createRadialGradient(256, 128, 5, 256, 128, 80);
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
                    mats.forEach(m => {
                        // dispose textures
                        const textureProps = [
                            'map', 'normalMap', 'roughnessMap', 'metalnessMap',
                            'aoMap', 'emissiveMap', 'alphaMap', 'envMap'
                        ];
                        textureProps.forEach(prop => {
                            if (m[prop]) m[prop].dispose();
                        });
                        m.dispose();
                    });
                }
            }
        });
    }
}
