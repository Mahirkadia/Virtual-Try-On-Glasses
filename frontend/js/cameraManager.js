/**
 * CameraManager - Handles webcam access, video streaming, mirroring, and frame capture.
 * 
 * Usage:
 *   const camera = new CameraManager();
 *   await camera.init(document.getElementById('camera-video'));
 *   // ... use camera ...
 *   camera.stop();
 */
class CameraManager {
    constructor() {
        /** @type {HTMLVideoElement|null} */
        this.video = null;
        /** @type {MediaStream|null} */
        this.stream = null;
        /** @type {boolean} */
        this.isRunning = false;
        /** @type {boolean} */
        this.isMirrored = true;
        /** @type {string} */
        this._facingMode = 'user';
        /** @type {OffscreenCanvas|HTMLCanvasElement|null} */
        this._captureCanvas = null;
        /** @type {CanvasRenderingContext2D|null} */
        this._captureCtx = null;
    }

    /**
     * Initialize the camera and begin streaming to the provided video element.
     * @param {HTMLVideoElement} videoElement - The <video> element to stream into.
     * @returns {Promise<void>}
     */
    async init(videoElement) {
        if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
            throw new Error('A valid HTMLVideoElement is required to initialize the camera.');
        }

        this.video = videoElement;

        // Check for browser support
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error(
                'Your browser does not support camera access. ' +
                'Please use a modern browser like Chrome, Firefox, or Edge.'
            );
        }

        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: this._facingMode
            },
            audio: false
        };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            this._handleCameraError(err);
            return; // _handleCameraError always throws, but just in case
        }

        this.video.srcObject = this.stream;
        this.video.setAttribute('playsinline', 'true'); // Required for iOS
        this.video.setAttribute('autoplay', 'true');
        this.video.muted = true;

        // Wait for the video to be ready
        await this._waitForVideo();

        // Apply mirror transform for user-facing camera
        this._applyMirror();

        this.isRunning = true;

        console.log(
            `[CameraManager] Camera initialized: ${this.video.videoWidth}x${this.video.videoHeight}`
        );
    }

    /**
     * Wait for the video element to have loaded data and be playing.
     * @returns {Promise<void>}
     * @private
     */
    _waitForVideo() {
        return new Promise((resolve, reject) => {
            // If already ready
            if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                this.video.play().then(resolve).catch(reject);
                return;
            }

            const onLoadedData = () => {
                cleanup();
                this.video.play().then(resolve).catch(reject);
            };

            const onError = () => {
                cleanup();
                reject(new Error('Video element encountered an error while loading camera data.'));
            };

            const cleanup = () => {
                this.video.removeEventListener('loadeddata', onLoadedData);
                this.video.removeEventListener('error', onError);
                clearTimeout(timeout);
            };

            // Timeout after 10 seconds
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Camera took too long to start. Please try refreshing the page.'));
            }, 10000);

            this.video.addEventListener('loadeddata', onLoadedData);
            this.video.addEventListener('error', onError);
        });
    }

    /**
     * Handle camera access errors with user-friendly messages.
     * @param {Error} err
     * @private
     */
    _handleCameraError(err) {
        let message;

        switch (err.name) {
            case 'NotAllowedError':
            case 'PermissionDeniedError':
                message =
                    'Camera access was denied. Please allow camera permissions in your browser settings and reload the page.';
                break;
            case 'NotFoundError':
            case 'DevicesNotFoundError':
                message =
                    'No camera was found on this device. Please connect a webcam and try again.';
                break;
            case 'NotReadableError':
            case 'TrackStartError':
                message =
                    'Camera is already in use by another application. Please close other apps using the camera and try again.';
                break;
            case 'OverconstrainedError':
                message =
                    'Camera does not support the requested resolution. Trying with default settings...';
                // Could attempt fallback here, but we throw for now
                break;
            case 'AbortError':
                message = 'Camera access was aborted. Please try again.';
                break;
            default:
                message = `Camera error: ${err.message || 'Unknown error occurred.'}`;
        }

        console.error(`[CameraManager] ${message}`, err);
        throw new Error(message);
    }

    /**
     * Apply or remove mirror (horizontal flip) CSS transform on the video element.
     * @private
     */
    _applyMirror() {
        if (!this.video) return;

        if (this.isMirrored) {
            this.video.style.transform = 'scaleX(-1)';
        } else {
            this.video.style.transform = 'scaleX(1)';
        }
    }

    /**
     * Stop the camera and release all tracks.
     */
    stop() {
        if (this.stream) {
            const tracks = this.stream.getTracks();
            tracks.forEach(track => {
                track.stop();
                console.log(`[CameraManager] Stopped track: ${track.kind}`);
            });
            this.stream = null;
        }

        if (this.video) {
            this.video.srcObject = null;
        }

        this.isRunning = false;
        this._captureCanvas = null;
        this._captureCtx = null;

        console.log('[CameraManager] Camera stopped.');
    }

    /**
     * Get a reference to the video element.
     * @returns {HTMLVideoElement|null}
     */
    getVideoElement() {
        return this.video;
    }

    /**
     * Get the actual video dimensions (from the stream, not the element).
     * @returns {{ width: number, height: number }}
     */
    getVideoDimensions() {
        if (!this.video) {
            return { width: 0, height: 0 };
        }
        return {
            width: this.video.videoWidth || 0,
            height: this.video.videoHeight || 0
        };
    }

    /**
     * Toggle between front ("user") and rear ("environment") camera.
     * @returns {Promise<void>}
     */
    async switchCamera() {
        if (!this.video) {
            throw new Error('Camera is not initialized. Call init() first.');
        }

        // Toggle facing mode
        this._facingMode = this._facingMode === 'user' ? 'environment' : 'user';

        // Update mirror: front camera is mirrored, rear is not
        this.isMirrored = this._facingMode === 'user';

        // Stop current stream
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }

        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: this._facingMode
            },
            audio: false
        };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            await this._waitForVideo();
            this._applyMirror();

            console.log(`[CameraManager] Switched to ${this._facingMode} camera.`);
        } catch (err) {
            // Revert facing mode on failure
            this._facingMode = this._facingMode === 'user' ? 'environment' : 'user';
            this.isMirrored = this._facingMode === 'user';
            this._handleCameraError(err);
        }
    }

    /**
     * Set the mirror state explicitly.
     * @param {boolean} mirrored
     */
    setMirrored(mirrored) {
        this.isMirrored = !!mirrored;
        this._applyMirror();
    }

    /**
     * Capture the current video frame as a canvas.
     * Handles mirroring so the captured image matches what the user sees.
     * @returns {HTMLCanvasElement} - Canvas containing the current video frame.
     */
    captureFrame() {
        if (!this.video || !this.isRunning) {
            throw new Error('Camera is not running. Cannot capture frame.');
        }

        const width = this.video.videoWidth;
        const height = this.video.videoHeight;

        // Reuse canvas if dimensions match
        if (
            !this._captureCanvas ||
            this._captureCanvas.width !== width ||
            this._captureCanvas.height !== height
        ) {
            this._captureCanvas = document.createElement('canvas');
            this._captureCanvas.width = width;
            this._captureCanvas.height = height;
            this._captureCtx = this._captureCanvas.getContext('2d');
        }

        const ctx = this._captureCtx;

        if (this.isMirrored) {
            // Flip horizontally to match the mirrored video display
            ctx.save();
            ctx.translate(width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(this.video, 0, 0, width, height);
            ctx.restore();
        } else {
            ctx.drawImage(this.video, 0, 0, width, height);
        }

        return this._captureCanvas;
    }

    /**
     * Check if camera hardware supports switching (has multiple cameras).
     * @returns {Promise<boolean>}
     */
    async canSwitchCamera() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            return videoDevices.length > 1;
        } catch {
            return false;
        }
    }
}
