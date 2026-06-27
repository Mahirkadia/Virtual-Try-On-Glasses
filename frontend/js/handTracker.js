/**
 * HandTracker - Uses MediaPipe Hand Landmarker for real-time hand detection,
 * skeleton tracking, and calculation of transformation parameters for rings, watches, and bracelets.
 *
 * Requires MediaPipe Tasks Vision loaded from CDN:
 *   <script src="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest"></script>
 */
class HandTracker {
    constructor() {
        /** @type {HandLandmarker|null} */
        this.handLandmarker = null;
        /** @type {boolean} */
        this.isInitialized = false;
        /** @type {object|null} */
        this.lastResults = null;
        /** @type {Array|null} */
        this.smoothedLandmarks = null;
        /** @type {object|null} */
        this.previousSmoothedLandmarks = null;

        // Smoothing configuration (Exponential Moving Average)
        this.smoothingFactor = 0.5; // lower = more smooth/stable, higher = faster response
        this.deadZone = 0.0005;

        // Key landmark reference indexes (MediaPipe Hand model has 21 landmarks)
        this.LANDMARKS = {
            WRIST: 0,
            THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
            INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
            MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
            RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
            PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
        };

        this._videoWidth = 0;
        this._videoHeight = 0;
        this._lastErrorTime = 0;
    }

    /**
     * Initialize the MediaPipe Hand Landmarker.
     */
    async init() {
        if (this.isInitialized) {
            console.warn('[HandTracker] Already initialized.');
            return;
        }

        const visionModule = window.vision || self.vision || {
            HandLandmarker: typeof HandLandmarker !== 'undefined' ? HandLandmarker : null,
            FilesetResolver: typeof FilesetResolver !== 'undefined' ? FilesetResolver : null
        };

        if (!visionModule.HandLandmarker || !visionModule.FilesetResolver) {
            throw new Error('MediaPipe HandLandmarker or FilesetResolver not found in global scope.');
        }

        try {
            console.log('[HandTracker] Loading MediaPipe WASM runtime...');

            const wasmFileset = await visionModule.FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
            );

            console.log('[HandTracker] Creating HandLandmarker...');

            this.handLandmarker = await visionModule.HandLandmarker.createFromOptions(wasmFileset, {
                baseOptions: {
                    modelAssetPath:
                        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                    delegate: 'GPU' // Fallback to CPU happens automatically in browser if GPU not available
                },
                runningMode: 'VIDEO',
                numHands: 1, // Only track one hand for jewelry try-on
                minHandDetectionConfidence: 0.5,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            this.isInitialized = true;
            console.log('[HandTracker] Hand Landmarker initialized successfully.');
        } catch (err) {
            console.error('[HandTracker] Initialization failed:', err);
            throw new Error(`Failed to initialize hand tracking: ${err.message}`);
        }
    }

    /**
     * Detect hands in the current video frame.
     * @param {HTMLVideoElement} videoElement
     * @param {number} timestamp - performance.now()
     */
    detect(videoElement, timestamp) {
        if (!this.isInitialized || !this.handLandmarker) {
            return null;
        }

        if (!videoElement || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return null;
        }

        this._videoWidth = videoElement.videoWidth;
        this._videoHeight = videoElement.videoHeight;

        try {
            this.lastResults = this.handLandmarker.detectForVideo(videoElement, timestamp);

            // Apply smoothing if a hand is detected
            if (this._hasHand()) {
                const rawLandmarks = this.lastResults.landmarks[0];
                this.smoothedLandmarks = this._smoothLandmarks(rawLandmarks);
            } else {
                this.resetSmoothing();
            }

            return this.lastResults;
        } catch (err) {
            if (performance.now() - this._lastErrorTime > 5000) {
                console.error('[HandTracker] Detection error:', err);
                this._lastErrorTime = performance.now();
            }
            return null;
        }
    }

    /**
     * Get transform data for placing a ring on a specific finger.
     * @param {string} fingerName - 'ring', 'middle', 'index', 'pinky', 'thumb'
     * @returns {object|null} Position, rotation, and scale for Three.js
     */
    getRingData(fingerName = 'ring') {
        if (!this._hasHand() || !this.smoothedLandmarks) {
            return null;
        }

        const lm = this.smoothedLandmarks;
        const aspect = this._videoWidth / this._videoHeight;

        // Determine handedness to orient the model correctly
        let isLeft = false;
        if (this.lastResults && this.lastResults.handedness && this.lastResults.handedness.length > 0) {
            isLeft = this.lastResults.handedness[0][0].categoryName === 'Left';
        }
        // In Three.js space (with Y and Z inverted relative to raw),
        // we use isLeft ? -1 : 1 for handSign to align the normal out of the back of the hand.
        const handSign = isLeft ? -1 : 1;

        // Convert a MediaPipe landmark to Three.js world coordinates
        const toWorld = (p) => ({
            x: (p.x - 0.5) * 2.0 * aspect,
            y: -(p.y - 0.5) * 2.0,
            z: -p.z * 1.5
        });

        // Determine landmarks based on finger
        let mcpIdx, pipIdx, dipIdx;
        switch (fingerName.toLowerCase()) {
            case 'thumb':
                mcpIdx = this.LANDMARKS.THUMB_CMC;
                pipIdx = this.LANDMARKS.THUMB_MCP;
                dipIdx = this.LANDMARKS.THUMB_IP;
                break;
            case 'index':
                mcpIdx = this.LANDMARKS.INDEX_MCP;
                pipIdx = this.LANDMARKS.INDEX_PIP;
                dipIdx = this.LANDMARKS.INDEX_DIP;
                break;
            case 'middle':
                mcpIdx = this.LANDMARKS.MIDDLE_MCP;
                pipIdx = this.LANDMARKS.MIDDLE_PIP;
                dipIdx = this.LANDMARKS.MIDDLE_DIP;
                break;
            case 'pinky':
                mcpIdx = this.LANDMARKS.PINKY_MCP;
                pipIdx = this.LANDMARKS.PINKY_PIP;
                dipIdx = this.LANDMARKS.PINKY_DIP;
                break;
            case 'ring':
            default:
                mcpIdx = this.LANDMARKS.RING_MCP;
                pipIdx = this.LANDMARKS.RING_PIP;
                dipIdx = this.LANDMARKS.RING_DIP;
                break;
        }

        const mcp = lm[mcpIdx];
        const pip = lm[pipIdx];

        // 1. POSITION: Ring sits in the middle of the lower phalanx (between MCP and PIP)
        // We put it at 35% of the way from MCP to PIP (near the finger base)
        const mcpW = toWorld(mcp);
        const pipW = toWorld(pip);

        const alpha = 0.48;
        const worldX = mcpW.x + alpha * (pipW.x - mcpW.x);
        const worldY = mcpW.y + alpha * (pipW.y - mcpW.y);
        const worldZ = mcpW.z + alpha * (pipW.z - mcpW.z);

        // 2. DIRECTION/ROTATION (Y-axis direction of the finger)
        const dirY = {
            x: pipW.x - mcpW.x,
            y: pipW.y - mcpW.y,
            z: pipW.z - mcpW.z
        };
        const lenY = Math.sqrt(dirY.x*dirY.x + dirY.y*dirY.y + dirY.z*dirY.z);
        dirY.x /= lenY;
        dirY.y /= lenY;
        dirY.z /= lenY;

        // Hand span vector (from index knuckle to pinky knuckle in Three.js space)
        const pinkyW = toWorld(lm[this.LANDMARKS.PINKY_MCP]);
        const indexW = toWorld(lm[this.LANDMARKS.INDEX_MCP]);
        const handSpan = {
            x: pinkyW.x - indexW.x,
            y: pinkyW.y - indexW.y,
            z: pinkyW.z - indexW.z
        };
        const lenSpan = Math.sqrt(handSpan.x*handSpan.x + handSpan.y*handSpan.y + handSpan.z*handSpan.z);
        handSpan.x /= lenSpan;
        handSpan.y /= lenSpan;
        handSpan.z /= lenSpan;

        // Z = Span x Y (pointing out of the hand back)
        // Multiply by handSign so normal always points OUT of the back of the hand
        const rawDirZ = {
            x: handSpan.y * dirY.z - handSpan.z * dirY.y,
            y: handSpan.z * dirY.x - handSpan.x * dirY.z,
            z: handSpan.x * dirY.y - handSpan.y * dirY.x
        };
        const lenZ = Math.sqrt(rawDirZ.x*rawDirZ.x + rawDirZ.y*rawDirZ.y + rawDirZ.z*rawDirZ.z);
        let dirZ = {
            x: (rawDirZ.x / lenZ) * handSign,
            y: (rawDirZ.y / lenZ) * handSign,
            z: (rawDirZ.z / lenZ) * handSign
        };

        // X = Y x Z (pointing sideways relative to finger)
        let dirX = {
            x: dirY.y * dirZ.z - dirY.z * dirZ.y,
            y: dirY.z * dirZ.x - dirY.x * dirZ.z,
            z: dirY.x * dirZ.y - dirY.y * dirZ.x
        };

        // Removed snap-flip block to enable smooth 360-degree rotation.
        // The gemstone naturally goes behind the finger when palm is facing the camera.

        // 3. SCALE: The finger width can be estimated by the MCP-to-PIP length in world units.
        const fingerLength = Math.sqrt(
            (mcpW.x - pipW.x)**2 +
            (mcpW.y - pipW.y)**2 +
            (mcpW.z - pipW.z)**2
        );
        const scale = fingerLength * 0.41; // fits ring to finger width (equivalent to raw 0.31)

        return {
            position: { x: worldX, y: worldY, z: worldZ },
            direction: {
                x: dirX,
                y: dirY,
                z: dirZ
            },
            scale,
            fingerLength
        };
    }

    /**
     * Get transform data for placing a watch or bracelet on the wrist.
     * @returns {object|null} Position, rotation, and scale for Three.js
     */
    getWristData() {
        if (!this._hasHand() || !this.smoothedLandmarks) {
            return null;
        }

        const lm = this.smoothedLandmarks;
        const aspect = this._videoWidth / this._videoHeight;

        // Determine handedness to orient the model correctly
        let isLeft = false;
        if (this.lastResults && this.lastResults.handedness && this.lastResults.handedness.length > 0) {
            isLeft = this.lastResults.handedness[0][0].categoryName === 'Left';
        }
        // In Three.js space (with Y and Z inverted relative to raw),
        // we use isLeft ? -1 : 1 for handSign to align the normal out of the back of the hand.
        const handSign = isLeft ? -1 : 1;

        // Convert a MediaPipe landmark to Three.js world coordinates
        const toWorld = (p) => ({
            x: (p.x - 0.5) * 2.0 * aspect,
            y: -(p.y - 0.5) * 2.0,
            z: -p.z * 1.5
        });

        const wrist = lm[this.LANDMARKS.WRIST];
        const indexMcp = lm[this.LANDMARKS.INDEX_MCP];
        const pinkyMcp = lm[this.LANDMARKS.PINKY_MCP];
        const middleMcp = lm[this.LANDMARKS.MIDDLE_MCP];

        const wristW = toWorld(wrist);
        const indexMcpW = toWorld(indexMcp);
        const pinkyMcpW = toWorld(pinkyMcp);
        const middleMcpW = toWorld(middleMcp);

        // 1. POSITION: Anchor is at the wrist joint (landmark 0), but pushed slightly back (towards forearm)
        // We approximate the forearm direction as pointing opposite to the middle finger direction.
        const armDir = {
            x: wristW.x - middleMcpW.x,
            y: wristW.y - middleMcpW.y,
            z: wristW.z - middleMcpW.z
        };
        const lenArm = Math.sqrt(armDir.x*armDir.x + armDir.y*armDir.y + armDir.z*armDir.z);
        armDir.x /= lenArm;
        armDir.y /= lenArm;
        armDir.z /= lenArm;

        // Shift position down the forearm (about 35% of hand size)
        const handSize = Math.sqrt(
            (wristW.x - middleMcpW.x)**2 +
            (wristW.y - middleMcpW.y)**2 +
            (wristW.z - middleMcpW.z)**2
        );
        const shiftAmount = handSize * 0.35;
        const worldX = wristW.x + armDir.x * shiftAmount;
        const worldY = wristW.y + armDir.y * shiftAmount;
        const worldZ = wristW.z + armDir.z * shiftAmount;

        // 2. ORIENTATION (Y-axis pointing along the forearm)
        const dirY = { x: -armDir.x, y: -armDir.y, z: -armDir.z };

        // Hand span plane (X-axis pointing thumb-to-pinky direction)
        const spanX = pinkyMcpW.x - indexMcpW.x;
        const spanY = pinkyMcpW.y - indexMcpW.y;
        const spanZ = pinkyMcpW.z - indexMcpW.z;
        const lenSpan = Math.sqrt(spanX*spanX + spanY*spanY + spanZ*spanZ);
        const dirX = { x: spanX / lenSpan, y: spanY / lenSpan, z: spanZ / lenSpan };

        // Normal vector (Z-axis pointing out of back of hand)
        // Z = X x Y
        const rawDirZ = {
            x: dirX.y * dirY.z - dirX.z * dirY.y,
            y: dirX.z * dirY.x - dirX.x * dirY.z,
            z: dirX.x * dirY.y - dirX.y * dirY.x
        };
        const lenZ = Math.sqrt(rawDirZ.x*rawDirZ.x + rawDirZ.y*rawDirZ.y + rawDirZ.z*rawDirZ.z);
        let dirZ = {
            x: (rawDirZ.x / lenZ) * handSign,
            y: (rawDirZ.y / lenZ) * handSign,
            z: (rawDirZ.z / lenZ) * handSign
        };

        // Re-orthogonalize X to maintain perpendicular axes (X = Y x Z)
        dirX.x = dirY.y * dirZ.z - dirY.z * dirZ.y;
        dirX.y = dirY.z * dirZ.x - dirY.x * dirZ.z;
        dirX.z = dirY.x * dirZ.y - dirY.y * dirZ.x;

        // Removed snap-flip block to enable smooth 360-degree rotation.
        // The watch face naturally goes behind the wrist when palm is facing the camera,
        // and only the strap is rendered on the palm side.

        // 3. SCALE: Base scale on hand width (index MCP to pinky MCP)
        const handWidth = Math.sqrt(
            (indexMcpW.x - pinkyMcpW.x)**2 +
            (indexMcpW.y - pinkyMcpW.y)**2 +
            (indexMcpW.z - pinkyMcpW.z)**2
        );
        const scale = handWidth * 0.72; // fits watch/bracelet diameter

        return {
            position: { x: worldX, y: worldY, z: worldZ },
            direction: {
                x: dirX,
                y: dirY,
                z: dirZ
            },
            scale,
            wristWidth: handWidth
        };
    }

    /**
     * Apply EMA (Exponential Moving Average) smoothing to landmarks to filter out frame jitter.
     */
    _smoothLandmarks(rawLandmarks) {
        const alpha = this.smoothingFactor;

        if (!this.previousSmoothedLandmarks) {
            this.previousSmoothedLandmarks = rawLandmarks.map(lm => ({
                x: lm.x,
                y: lm.y,
                z: lm.z
            }));
            return this.previousSmoothedLandmarks;
        }

        const smoothed = [];
        const prev = this.previousSmoothedLandmarks;

        for (let i = 0; i < rawLandmarks.length; i++) {
            const raw = rawLandmarks[i];
            const p = prev[i] || raw;

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

        this.previousSmoothedLandmarks = smoothed;
        return smoothed;
    }

    _hasHand() {
        return (
            this.lastResults &&
            this.lastResults.landmarks &&
            this.lastResults.landmarks.length > 0
        );
    }

    isDetected() {
        return this._hasHand();
    }

    resetSmoothing() {
        this.previousSmoothedLandmarks = null;
        this.smoothedLandmarks = null;
    }

    /**
     * Compute 3D Euclidean distance between two landmarks.
     * @param {object} a
     * @param {object} b
     * @returns {number}
     * @private
     */
    _distance3D(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    destroy() {
        if (this.handLandmarker) {
            this.handLandmarker.close();
            this.handLandmarker = null;
        }
        this.isInitialized = false;
        this.lastResults = null;
        this.resetSmoothing();
        console.log('[HandTracker] Destroyed.');
    }
}
