/**
 * FaceTracker - Uses MediaPipe Face Landmarker for real-time face detection
 * and landmark tracking. Computes glasses placement transforms with EMA smoothing.
 *
 * Requires MediaPipe Tasks Vision loaded from CDN:
 *   <script src="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest"></script>
 *
 * Usage:
 *   const tracker = new FaceTracker();
 *   await tracker.init();
 *   // In render loop:
 *   tracker.detect(videoElement, performance.now());
 *   if (tracker.isDetected()) {
 *       const data = tracker.getFaceData();
 *   }
 */
class FaceTracker {
    constructor() {
        /** @type {FaceLandmarker|null} */
        this.faceLandmarker = null;
        /** @type {boolean} */
        this.isInitialized = false;
        /** @type {object|null} */
        this.lastResults = null;
        /** @type {Array|null} */
        this.smoothedLandmarks = null;
        /** @type {object|null} */
        this.smoothedRotation = null;

        // Smoothing parameters
        /** @type {number} EMA alpha for landmark positions (higher = more responsive) */
        this.smoothingFactor = 0.7;
        /** @type {number} EMA alpha for rotation (higher = more responsive) */
        this.rotationSmoothingFactor = 0.7;
        /** @type {number} Dead zone threshold to ignore micro-jitter */
        this.deadZone = 0.0005;

        // Cached raw transformation matrix for direct use
        this._rawMatrix = null;

        // Cached dimensions from last detect call
        this._videoWidth = 0;
        this._videoHeight = 0;

        // Camera FOV approximation
        this._fov = 50; // degrees, approximate webcam FOV
        this._fovScale = 1.0;

        // Key landmark indices (MediaPipe 468 landmark model)
        this.LANDMARKS = {
            NOSE_BRIDGE: 168,
            LEFT_EYE_OUTER: 263,   // Swapped (anatomical left)
            RIGHT_EYE_OUTER: 33,   // Swapped (anatomical right)
            LEFT_EYE_INNER: 362,   // Swapped (anatomical left)
            RIGHT_EYE_INNER: 133,  // Swapped (anatomical right)
            FOREHEAD: 10,
            CHIN: 152,
            LEFT_EAR: 454,         // Swapped (anatomical left)
            RIGHT_EAR: 234,        // Swapped (anatomical right)
            NOSE_TIP: 1,
            LEFT_TEMPLE: 356,      // Swapped (anatomical left)
            RIGHT_TEMPLE: 127      // Swapped (anatomical right)
        };
    }

    /**
     * Initialize the MediaPipe Face Landmarker model.
     * @returns {Promise<void>}
     */
    async init() {
        if (this.isInitialized) {
            console.warn('[FaceTracker] Already initialized.');
            return;
        }

        // Ensure MediaPipe Tasks Vision is available
        if (typeof window.vision === 'undefined' && typeof vision === 'undefined') {
            // Try to access from the global scope set by the CDN script
            if (typeof FaceLandmarker === 'undefined') {
                throw new Error(
                    'MediaPipe Tasks Vision is not loaded. ' +
                    'Please include the script: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest'
                );
            }
        }

        const visionModule = window.vision || self.vision || {
            FaceLandmarker: typeof FaceLandmarker !== 'undefined' ? FaceLandmarker : null,
            FilesetResolver: typeof FilesetResolver !== 'undefined' ? FilesetResolver : null
        };

        if (!visionModule.FaceLandmarker || !visionModule.FilesetResolver) {
            throw new Error('MediaPipe FaceLandmarker or FilesetResolver not found in global scope.');
        }

        try {
            console.log('[FaceTracker] Loading MediaPipe WASM runtime...');

            const wasmFileset = await visionModule.FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
            );

            console.log('[FaceTracker] Creating FaceLandmarker...');

            this.faceLandmarker = await visionModule.FaceLandmarker.createFromOptions(wasmFileset, {
                baseOptions: {
                    modelAssetPath:
                        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                    delegate: 'GPU'
                },
                runningMode: 'VIDEO',
                numFaces: 1,
                outputFaceBlendshapes: false,
                outputFacialTransformationMatrixes: true
            });

            this.isInitialized = true;
            console.log('[FaceTracker] Face Landmarker initialized successfully.');
        } catch (err) {
            console.error('[FaceTracker] Initialization failed:', err);
            throw new Error(`Failed to initialize face tracking: ${err.message}`);
        }
    }

    /**
     * Detect faces in the current video frame.
     * @param {HTMLVideoElement} videoElement
     * @param {number} timestamp - performance.now() timestamp
     * @returns {object|null} - Raw detection results
     */
    detect(videoElement, timestamp) {
        if (!this.isInitialized || !this.faceLandmarker) {
            return null;
        }

        if (!videoElement || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return null;
        }

        // Cache video dimensions
        this._videoWidth  = videoElement.videoWidth;
        this._videoHeight = videoElement.videoHeight;

        try {
            this.lastResults = this.faceLandmarker.detectForVideo(videoElement, timestamp);

            // Apply smoothing if a face is detected
            if (this._hasFace()) {
                const rawLandmarks = this.lastResults.faceLandmarks[0];
                this.smoothedLandmarks = this._smoothLandmarks(rawLandmarks);

                // Store and smooth the full 4x4 transformation matrix
                if (
                    this.lastResults.facialTransformationMatrixes &&
                    this.lastResults.facialTransformationMatrixes.length > 0
                ) {
                    const matData = this.lastResults.facialTransformationMatrixes[0].data ||
                                    this.lastResults.facialTransformationMatrixes[0];
                    this._rawMatrix = matData;

                    const rawRotation = this._computeHeadRotation(matData);
                    this.smoothedRotation = this._smoothRotation(rawRotation);
                }
            }

            return this.lastResults;
        } catch (err) {
            // Don't spam the console on every frame
            if (!this._lastErrorTime || performance.now() - this._lastErrorTime > 5000) {
                console.error('[FaceTracker] Detection error:', err);
                this._lastErrorTime = performance.now();
            }
            return null;
        }
    }

    /**
     * Get comprehensive face data for glasses placement.
     * @returns {object|null}
     */
    getFaceData() {
        if (!this._hasFace() || !this.smoothedLandmarks) {
            return null;
        }

        const lm = this.smoothedLandmarks;

        // Extract key landmarks
        const noseBridge = lm[this.LANDMARKS.NOSE_BRIDGE];
        const leftEyeOuter = lm[this.LANDMARKS.LEFT_EYE_OUTER];
        const rightEyeOuter = lm[this.LANDMARKS.RIGHT_EYE_OUTER];
        const leftEyeInner = lm[this.LANDMARKS.LEFT_EYE_INNER];
        const rightEyeInner = lm[this.LANDMARKS.RIGHT_EYE_INNER];
        const forehead = lm[this.LANDMARKS.FOREHEAD];
        const chin = lm[this.LANDMARKS.CHIN];
        const leftEar = lm[this.LANDMARKS.LEFT_EAR];
        const rightEar = lm[this.LANDMARKS.RIGHT_EAR];
        const noseTip = lm[this.LANDMARKS.NOSE_TIP];

        // Face center: midpoint between outer eye corners
        const faceCenter = {
            x: (leftEyeOuter.x + rightEyeOuter.x) / 2,
            y: (leftEyeOuter.y + rightEyeOuter.y) / 2,
            z: (leftEyeOuter.z + rightEyeOuter.z) / 2
        };

        // Eye distance (inter-pupillary approximation)
        const eyeDistance = this._distance3D(leftEyeOuter, rightEyeOuter);

        // Face width (ear to ear)
        const faceWidth = this._distance3D(leftEar, rightEar);

        // Face height (forehead to chin)
        const faceHeight = this._distance3D(forehead, chin);

        // Head rotation from transformation matrix
        const headRotation = this.smoothedRotation || { pitch: 0, yaw: 0, roll: 0 };

        // Compute glasses transform in Three.js coordinates
        const glassesTransform = this._computeGlassesTransform(
            lm,
            this._videoWidth,
            this._videoHeight
        );

        return {
            // Key landmarks (normalized coords)
            landmarks: {
                noseBridge,
                leftEyeOuter,
                rightEyeOuter,
                leftEyeInner,
                rightEyeInner,
                forehead,
                chin,
                leftEar,
                rightEar,
                noseTip
            },
            // Computed metrics
            faceCenter,
            eyeDistance,
            faceWidth,
            faceHeight,
            // Head rotation
            headRotation,
            // Three.js-ready transform
            position: glassesTransform.position,
            rotation: glassesTransform.rotation,
            scale: glassesTransform.scale,
            // Raw values for debugging
            videoWidth: this._videoWidth,
            videoHeight: this._videoHeight
        };
    }

    /**
     * Get transform data for placing earrings on the ears.
     * @returns {object|null} Position, rotation, and scale for Three.js
     */
    getEarringsData() {
        if (!this._hasFace() || !this.smoothedLandmarks) {
            return null;
        }

        const lm = this.smoothedLandmarks;
        const aspect = this._videoWidth / this._videoHeight;

        // Midpoint between ears or outer eye corners as position anchor
        const leftEar = lm[this.LANDMARKS.LEFT_EAR];
        const rightEar = lm[this.LANDMARKS.RIGHT_EAR];

        const leftEarW = {
            x: (leftEar.x - 0.5) * 2.0 * aspect,
            y: -(leftEar.y - 0.5) * 2.0,
            z: -leftEar.z * 2.0 * aspect
        };
        const rightEarW = {
            x: (rightEar.x - 0.5) * 2.0 * aspect,
            y: -(rightEar.y - 0.5) * 2.0,
            z: -rightEar.z * 2.0 * aspect
        };

        // Midpoint of the ears is the anchor position
        const worldX = (leftEarW.x + rightEarW.x) / 2;
        const worldY = (leftEarW.y + rightEarW.y) / 2;
        const worldZ = (leftEarW.z + rightEarW.z) / 2;

        // Scale is based on the 3D distance between the ears
        const earSpan = Math.sqrt(
            (leftEarW.x - rightEarW.x) ** 2 +
            (leftEarW.y - rightEarW.y) ** 2 +
            (leftEarW.z - rightEarW.z) ** 2
        );
        const scale = earSpan;

        // Rotation matches head rotation
        const rotation = this.smoothedRotation || { pitch: 0, yaw: 0, roll: 0 };
        
        // Geometric roll for stability
        const leftEyeOuter  = lm[this.LANDMARKS.LEFT_EYE_OUTER];
        const rightEyeOuter = lm[this.LANDMARKS.RIGHT_EYE_OUTER];
        const eyeDx = leftEyeOuter.x - rightEyeOuter.x;
        const eyeDy = leftEyeOuter.y - rightEyeOuter.y;
        const geomRoll = Math.atan2(eyeDy, eyeDx);

        return {
            position: { x: worldX, y: worldY, z: worldZ },
            rotation: { x: rotation.pitch, y: rotation.yaw, z: geomRoll },
            scale,
            leftEar: leftEarW,
            rightEar: rightEarW
        };
    }

    /**
     * Get transform data for placing a necklace around the neck.
     * @returns {object|null} Position, rotation, and scale for Three.js
     */
    getNecklaceData() {
        if (!this._hasFace() || !this.smoothedLandmarks) {
            return null;
        }

        const lm = this.smoothedLandmarks;
        const aspect = this._videoWidth / this._videoHeight;

        const chin = lm[this.LANDMARKS.CHIN];
        const forehead = lm[this.LANDMARKS.FOREHEAD];
        const leftEar = lm[this.LANDMARKS.LEFT_EAR];
        const rightEar = lm[this.LANDMARKS.RIGHT_EAR];

        const chinW = {
            x: (chin.x - 0.5) * 2.0 * aspect,
            y: -(chin.y - 0.5) * 2.0,
            z: -chin.z * 2.0 * aspect
        };
        const foreheadW = {
            x: (forehead.x - 0.5) * 2.0 * aspect,
            y: -(forehead.y - 0.5) * 2.0,
            z: -forehead.z * 2.0 * aspect
        };
        const leftEarW = {
            x: (leftEar.x - 0.5) * 2.0 * aspect,
            y: -(leftEar.y - 0.5) * 2.0,
            z: -leftEar.z * 2.0 * aspect
        };
        const rightEarW = {
            x: (rightEar.x - 0.5) * 2.0 * aspect,
            y: -(rightEar.y - 0.5) * 2.0,
            z: -rightEar.z * 2.0 * aspect
        };

        const faceHeight = Math.sqrt(
            (foreheadW.x - chinW.x) ** 2 +
            (foreheadW.y - chinW.y) ** 2 +
            (foreheadW.z - chinW.z) ** 2
        );

        // Position: shifted below the chin along the neck axis
        const faceDirY = {
            x: chinW.x - foreheadW.x,
            y: chinW.y - foreheadW.y,
            z: chinW.z - foreheadW.z
        };
        const lenY = Math.sqrt(faceDirY.x*faceDirY.x + faceDirY.y*faceDirY.y + faceDirY.z*faceDirY.z);
        faceDirY.x /= lenY;
        faceDirY.y /= lenY;
        faceDirY.z /= lenY;

        // Shift down from the chin by about 42% of the face height
        const shiftY = faceHeight * 0.42;
        // Shift slightly backward to sit on the neck
        const shiftZ = -faceHeight * 0.12;

        const worldX = chinW.x + faceDirY.x * shiftY;
        const worldY = chinW.y + faceDirY.y * shiftY;
        const worldZ = chinW.z + faceDirY.z * shiftY + shiftZ;

        // Scale: based on face width (ear span) to scale the neck loop size
        const earSpan = Math.sqrt(
            (leftEarW.x - rightEarW.x) ** 2 +
            (leftEarW.y - rightEarW.y) ** 2 +
            (leftEarW.z - rightEarW.z) ** 2
        );
        const scale = earSpan * 1.05;

        // Rotation matches head rotation
        const rotation = this.smoothedRotation || { pitch: 0, yaw: 0, roll: 0 };
        
        // Geometric roll for stability
        const leftEyeOuter  = lm[this.LANDMARKS.LEFT_EYE_OUTER];
        const rightEyeOuter = lm[this.LANDMARKS.RIGHT_EYE_OUTER];
        const eyeDx = leftEyeOuter.x - rightEyeOuter.x;
        const eyeDy = leftEyeOuter.y - rightEyeOuter.y;
        const geomRoll = Math.atan2(eyeDy, eyeDx);

        return {
            position: { x: worldX, y: worldY, z: worldZ },
            rotation: { x: rotation.pitch * 0.8, y: rotation.yaw * 0.8, z: geomRoll * 0.8 },
            scale,
            faceHeight
        };
    }

    /**
     * Apply Exponential Moving Average (EMA) smoothing to landmarks.
     * @param {Array} rawLandmarks - Current frame landmarks
     * @returns {Array} Smoothed landmarks
     * @private
     */
    _smoothLandmarks(rawLandmarks) {
        const alpha = this.smoothingFactor;

        if (!this._previousSmoothedLandmarks) {
            // First frame: deep clone landmarks
            this._previousSmoothedLandmarks = rawLandmarks.map(lm => ({
                x: lm.x,
                y: lm.y,
                z: lm.z
            }));
            return this._previousSmoothedLandmarks;
        }

        const smoothed = [];
        const prev = this._previousSmoothedLandmarks;

        for (let i = 0; i < rawLandmarks.length; i++) {
            const raw = rawLandmarks[i];
            const p = prev[i] || raw;

            // Apply dead zone: if movement is smaller than threshold, keep previous
            const dx = Math.abs(raw.x - p.x);
            const dy = Math.abs(raw.y - p.y);
            const dz = Math.abs(raw.z - p.z);

            const smoothedPoint = {
                x: dx > this.deadZone ? alpha * raw.x + (1 - alpha) * p.x : p.x,
                y: dy > this.deadZone ? alpha * raw.y + (1 - alpha) * p.y : p.y,
                z: dz > this.deadZone ? alpha * raw.z + (1 - alpha) * p.z : p.z
            };

            smoothed.push(smoothedPoint);
        }

        this._previousSmoothedLandmarks = smoothed;
        return smoothed;
    }

    /**
     * Smooth rotation values with EMA.
     * @param {object} rawRotation - { pitch, yaw, roll }
     * @returns {object} Smoothed rotation
     * @private
     */
    _smoothRotation(rawRotation) {
        const alpha = this.rotationSmoothingFactor;

        if (!this._previousRotation) {
            this._previousRotation = { ...rawRotation };
            return rawRotation;
        }

        const prev = this._previousRotation;
        const deadZone = 0.005; // radians

        const smoothed = {
            pitch:
                Math.abs(rawRotation.pitch - prev.pitch) > deadZone
                    ? alpha * rawRotation.pitch + (1 - alpha) * prev.pitch
                    : prev.pitch,
            yaw:
                Math.abs(rawRotation.yaw - prev.yaw) > deadZone
                    ? alpha * rawRotation.yaw + (1 - alpha) * prev.yaw
                    : prev.yaw,
            roll:
                Math.abs(rawRotation.roll - prev.roll) > deadZone
                    ? alpha * rawRotation.roll + (1 - alpha) * prev.roll
                    : prev.roll
        };

        this._previousRotation = smoothed;
        return smoothed;
    }

    /**
     * Extract Euler angles from the 4x4 facial transformation matrix.
     *
     * MediaPipe facialTransformationMatrixes gives a column-major 4x4 matrix
     * that represents the head pose in camera space. We extract ZYX Euler
     * angles so they map directly to Three.js rotation.set(pitch, yaw, roll, 'ZYX').
     *
     * Canvas is mirrored via CSS scaleX(-1), so yaw must be negated to compensate.
     *
     * @param {Float32Array|Array} m - Flat 16-element column-major matrix
     * @returns {{ pitch: number, yaw: number, roll: number }}
     * @private
     */
    _computeHeadRotation(m) {
        if (!m || m.length < 16) {
            return { pitch: 0, yaw: 0, roll: 0 };
        }

        // Column-major layout:
        // m[0] m[4] m[8]  m[12]   → column 0
        // m[1] m[5] m[9]  m[13]   → column 1
        // m[2] m[6] m[10] m[14]   → column 2
        // m[3] m[7] m[11] m[15]   → column 3
        //
        // Rotation matrix R (row-major view):
        //   R = | m[0]  m[4]  m[8]  |
        //       | m[1]  m[5]  m[9]  |
        //       | m[2]  m[6]  m[10] |

        const r00 = m[0], r10 = m[1], r20 = m[2];
        const r01 = m[4], r11 = m[5], r21 = m[6];
        const r02 = m[8], r12 = m[9], r22 = m[10];

        // ZYX decomposition  →  Three.js Euler order 'ZYX' == rotation.set(X,Y,Z,'ZYX')
        let pitch, yaw, roll;

        const sinY = -r20;
        if (Math.abs(sinY) < 0.9999) {
            yaw   =  Math.asin(this._clamp(sinY, -1, 1));
            pitch =  Math.atan2(r21, r22);
            roll  =  Math.atan2(r10, r00);
        } else {
            // Gimbal lock
            yaw   = sinY > 0 ? Math.PI / 2 : -Math.PI / 2;
            pitch = Math.atan2(-r12, r11);
            roll  = 0;
        }

        // Canvas is horizontally mirrored (CSS scaleX(-1)).
        // We negate roll to keep tilt aligned. Yaw is kept as-is to correctly track head turns.
        roll = -roll;

        return { pitch, yaw, roll };
    }

    /**
     * Convert MediaPipe normalized landmarks + transformation matrix to
     * Three.js world coordinates for glasses placement.
     *
     * Camera is OrthographicCamera(-aspect, +aspect, +1, -1, 0.01, 100) at Z=10.
     * MediaPipe normalized coords: x,y ∈ [0,1], x→right, y→down.
     *
     * KEY INSIGHT: Position + scale track the face perfectly via landmarks.
     * For rotation, only roll (head tilt) is applied as a Z-rotation.
     * Pitch and yaw from the matrix cause the 3D pivot to swing the glasses
     * away from the landmark anchor — so we keep them at 0.
     * This matches how professional AR try-on apps keep glasses glued to the face.
     *
     * @param {Array} landmarks - Smoothed landmarks
     * @param {number} videoWidth
     * @param {number} videoHeight
     * @returns {{ position, rotation, scale }}
     * @private
     */
    _computeGlassesTransform(landmarks, videoWidth, videoHeight) {
        const aspect = videoWidth / videoHeight;

        const leftEyeOuter  = landmarks[this.LANDMARKS.LEFT_EYE_OUTER];
        const rightEyeOuter = landmarks[this.LANDMARKS.RIGHT_EYE_OUTER];
        const leftEyeInner  = landmarks[this.LANDMARKS.LEFT_EYE_INNER];
        const rightEyeInner = landmarks[this.LANDMARKS.RIGHT_EYE_INNER];

        // ── POSITION: midpoint of the four eye corners ─────────────────────────
        const anchorX = (leftEyeInner.x  + rightEyeInner.x +
                         leftEyeOuter.x  + rightEyeOuter.x) / 4;
        const anchorY = (leftEyeInner.y  + rightEyeInner.y +
                         leftEyeOuter.y  + rightEyeOuter.y) / 4;
        const anchorZ = (leftEyeInner.z  + rightEyeInner.z +
                         leftEyeOuter.z  + rightEyeOuter.z) / 4;

        // MediaPipe normalized → orthographic world coords
        const worldX = (anchorX - 0.5) * 2.0 * aspect;
        const worldY = -(anchorY - 0.5) * 2.0;
        // Map MediaPipe Z coordinate (multiplied by aspect to match coordinate scaling)
        const worldZ = -anchorZ * 2.0 * aspect;

        // ── SCALE: 3D distance between outer eye corners to prevent shrinking on turn ──
        const leftW = {
            x: leftEyeOuter.x * 2.0 * aspect,
            y: -leftEyeOuter.y * 2.0,
            z: -leftEyeOuter.z * 2.0 * aspect
        };
        const rightW = {
            x: rightEyeOuter.x * 2.0 * aspect,
            y: -rightEyeOuter.y * 2.0,
            z: -rightEyeOuter.z * 2.0 * aspect
        };
        const scale = Math.sqrt(
            (leftW.x - rightW.x) ** 2 +
            (leftW.y - rightW.y) ** 2 +
            (leftW.z - rightW.z) ** 2
        ) * 1.65; // Slightly adjusted scale factor for perfect face fit

        // ── ROTATION: Full 3D rotation (pitch, yaw, roll) ────────────────────
        const rotation = this.smoothedRotation || { pitch: 0, yaw: 0, roll: 0 };

        // Geometric roll is highly stable and automatically handles screen orientation
        const eyeDx = leftEyeOuter.x - rightEyeOuter.x;
        const eyeDy = leftEyeOuter.y - rightEyeOuter.y;
        const geomRoll = Math.atan2(eyeDy, eyeDx);

        return {
            position: { x: worldX, y: worldY, z: worldZ },
            rotation: { x: rotation.pitch, y: rotation.yaw, z: geomRoll },
            scale
        };
    }

    /**
     * Compute 3D Euclidean distance between two landmarks.
     * @param {object} a - { x, y, z }
     * @param {object} b - { x, y, z }
     * @returns {number}
     * @private
     */
    _distance3D(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Clamp a value to a range.
     * @param {number} val
     * @param {number} min
     * @param {number} max
     * @returns {number}
     * @private
     */
    _clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    /**
     * Check if any face is currently detected.
     * @returns {boolean}
     */
    isDetected() {
        return this._hasFace();
    }

    /**
     * Internal check for face presence.
     * @returns {boolean}
     * @private
     */
    _hasFace() {
        return (
            this.lastResults &&
            this.lastResults.faceLandmarks &&
            this.lastResults.faceLandmarks.length > 0
        );
    }

    /**
     * Get raw landmark results for debug/visualization.
     * @returns {object|null}
     */
    getRawResults() {
        return this.lastResults;
    }

    /**
     * Get the number of detected faces.
     * @returns {number}
     */
    getFaceCount() {
        if (!this.lastResults || !this.lastResults.faceLandmarks) return 0;
        return this.lastResults.faceLandmarks.length;
    }

    /**
     * Update the smoothing factor at runtime.
     * @param {number} alpha - Value between 0 (more smooth) and 1 (less smooth)
     */
    setSmoothingFactor(alpha) {
        this.smoothingFactor = this._clamp(alpha, 0.05, 1.0);
    }

    /**
     * Reset smoothing state (e.g., when face is lost and re-detected).
     */
    resetSmoothing() {
        this._previousSmoothedLandmarks = null;
        this._previousRotation = null;
        this.smoothedLandmarks = null;
        this.smoothedRotation = null;
        this._rawMatrix = null;
    }

    /**
     * Clean up and release resources.
     */
    destroy() {
        if (this.faceLandmarker) {
            this.faceLandmarker.close();
            this.faceLandmarker = null;
        }
        this.isInitialized = false;
        this.lastResults = null;
        this.smoothedLandmarks = null;
        this.smoothedRotation = null;
        this._previousSmoothedLandmarks = null;
        this._previousRotation = null;
        this._rawMatrix = null;

        console.log('[FaceTracker] Destroyed.');
    }
}
