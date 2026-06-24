/**
 * Admin Panel Controller
 * Handles GLB upload, metadata management, 3D preview, and CRUD operations
 */

class AdminPanel {
    constructor() {
        this.api = new GlassesAPI();
        this.glassesList = [];
        this.selectedFile = null;
        this.jsonMetadata = null;
        this.deleteTargetId = null;
        this.previewScene = null;
        this.previewCamera = null;
        this.previewRenderer = null;
        this.previewControls = null;
        this.previewModel = null;
        this.previewAnimId = null;
    }

    async init() {
        this._setupUploadZone();
        this._setupJsonUploadZone();
        this._setupSliders();
        this._setupFormActions();
        this._setupDeleteModal();
        this._setupRefresh();
        await this._loadData();
    }

    // ========================
    // Upload Zone Setup
    // ========================

    _setupUploadZone() {
        const zone = document.getElementById('glb-upload-zone');
        const input = document.getElementById('glb-file-input');

        // Click to browse
        zone.addEventListener('click', () => input.click());

        // Drag & Drop
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
                this._handleFileSelected(file);
            } else {
                this._showToast('Please drop a .glb or .gltf file', 'error');
            }
        });

        // File input change
        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this._handleFileSelected(e.target.files[0]);
            }
        });

        // Remove file button
        document.getElementById('btn-remove-file').addEventListener('click', () => {
            this._clearFile();
        });
    }

    _handleFileSelected(file) {
        this.selectedFile = file;

        // Show file info
        document.getElementById('glb-file-info').classList.remove('hidden');
        document.getElementById('glb-file-name').textContent = file.name;
        document.getElementById('glb-file-size').textContent = this._formatFileSize(file.size);

        // Show JSON zone
        document.getElementById('json-upload-zone').classList.remove('hidden');

        // Show form
        document.getElementById('upload-form').classList.add('visible');

        // Hide upload zone
        document.getElementById('glb-upload-zone').style.display = 'none';

        // Auto-fill name from filename
        const nameInput = document.getElementById('glasses-name');
        if (!nameInput.value) {
            nameInput.value = file.name.replace(/\.(glb|gltf)$/i, '').replace(/[-_]/g, ' ');
        }

        // Show 3D preview
        this._initPreview(file);

        this._showToast('File selected: ' + file.name, 'success');
    }

    _clearFile() {
        this.selectedFile = null;
        this.jsonMetadata = null;

        document.getElementById('glb-file-info').classList.add('hidden');
        document.getElementById('json-upload-zone').classList.add('hidden');
        document.getElementById('upload-form').classList.remove('visible');
        document.getElementById('glb-upload-zone').style.display = '';
        document.getElementById('glb-file-input').value = '';
        document.getElementById('json-file-input').value = '';
        document.getElementById('preview-section').style.display = 'none';

        // Reset form
        document.getElementById('upload-form').reset();
        this._resetSliderDisplays();

        // Cleanup preview
        this._destroyPreview();
    }

    // ========================
    // JSON Metadata Upload
    // ========================

    _setupJsonUploadZone() {
        const zone = document.getElementById('json-upload-zone');
        const input = document.getElementById('json-file-input');

        zone.addEventListener('click', () => input.click());

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.json')) {
                this._loadJsonMetadata(file);
            } else {
                this._showToast('Please drop a .json file', 'error');
            }
        });

        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this._loadJsonMetadata(e.target.files[0]);
            }
        });
    }

    async _loadJsonMetadata(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            this.jsonMetadata = data;

            // Auto-fill form fields from JSON
            if (data.name) document.getElementById('glasses-name').value = data.name;
            if (data.category) document.getElementById('glasses-category').value = data.category;
            if (data.brand) document.getElementById('glasses-brand').value = data.brand;
            if (data.description) document.getElementById('glasses-description').value = data.description;
            if (data.frame_color) document.getElementById('glasses-frame-color').value = data.frame_color;

            // Scale
            if (data.scale) {
                if (Array.isArray(data.scale)) {
                    this._setSlider('scale-x', data.scale[0]);
                    this._setSlider('scale-y', data.scale[1]);
                    this._setSlider('scale-z', data.scale[2]);
                } else {
                    if (data.scale_x != null) this._setSlider('scale-x', data.scale_x);
                    if (data.scale_y != null) this._setSlider('scale-y', data.scale_y);
                    if (data.scale_z != null) this._setSlider('scale-z', data.scale_z);
                }
            }
            if (data.scale_x != null) this._setSlider('scale-x', data.scale_x);
            if (data.scale_y != null) this._setSlider('scale-y', data.scale_y);
            if (data.scale_z != null) this._setSlider('scale-z', data.scale_z);

            // Position offset
            if (data.position_offset) {
                if (Array.isArray(data.position_offset)) {
                    this._setSlider('pos-x', data.position_offset[0]);
                    this._setSlider('pos-y', data.position_offset[1]);
                    this._setSlider('pos-z', data.position_offset[2]);
                }
            }
            if (data.position_offset_x != null) this._setSlider('pos-x', data.position_offset_x);
            if (data.position_offset_y != null) this._setSlider('pos-y', data.position_offset_y);
            if (data.position_offset_z != null) this._setSlider('pos-z', data.position_offset_z);

            // Rotation offset
            if (data.rotation_offset) {
                if (Array.isArray(data.rotation_offset)) {
                    this._setSlider('rot-x', data.rotation_offset[0]);
                    this._setSlider('rot-y', data.rotation_offset[1]);
                    this._setSlider('rot-z', data.rotation_offset[2]);
                }
            }
            if (data.rotation_offset_x != null) this._setSlider('rot-x', data.rotation_offset_x);
            if (data.rotation_offset_y != null) this._setSlider('rot-y', data.rotation_offset_y);
            if (data.rotation_offset_z != null) this._setSlider('rot-z', data.rotation_offset_z);

            // Fit params
            if (data.bridge_width != null) this._setSlider('bridge-width', data.bridge_width);
            if (data.temple_length != null) this._setSlider('temple-length', data.temple_length);
            if (data.lens_opacity != null) this._setSlider('lens-opacity', data.lens_opacity);

            // Auto-fit calculation using Bounding Box (BBOX_MIN / BBOX_MAX) if available
            const rawBboxMin = data.bbox_min || data.BBOX_MIN || data.bboxMin;
            const rawBboxMax = data.bbox_max || data.BBOX_MAX || data.bboxMax;

            const parseBBox = (val) => {
                if (!val) return null;
                if (Array.isArray(val)) return val.map(Number);
                if (typeof val === 'string') {
                    return val.split(',').map(s => parseFloat(s.trim()));
                }
                return null;
            };

            const bboxMin = parseBBox(rawBboxMin);
            const bboxMax = parseBBox(rawBboxMax);

            if (bboxMin && bboxMax && bboxMin.length === 3 && bboxMax.length === 3) {
                // The rendering engine now automatically centers the model and scales its width to 1.0.
                // We reset sliders to 1.0 scale and 0.0 offset so they try on perfectly out-of-the-box.
                this._setSlider('scale-x', 1.0);
                this._setSlider('scale-y', 1.0);
                this._setSlider('scale-z', 1.0);
                this._setSlider('pos-x', 0.0);
                this._setSlider('pos-y', 0.0);
                this._setSlider('pos-z', 0.0);

                this._showToast(`Dynamic auto-fit centering activated by rendering engine`, 'info');
            }

            // Visual indicator
            document.getElementById('json-upload-zone').classList.add('loaded');
            document.getElementById('json-upload-zone').querySelector('span').textContent = `✅ Loaded: ${file.name}`;

            this._showToast('Metadata loaded from JSON', 'success');
        } catch (e) {
            console.error('Failed to parse JSON:', e);
            this._showToast('Invalid JSON file: ' + e.message, 'error');
        }
    }

    // ========================
    // Slider Controls
    // ========================

    _setupSliders() {
        const sliders = [
            { id: 'scale-x', display: 'scale-x-value', format: v => parseFloat(v).toFixed(2) },
            { id: 'scale-y', display: 'scale-y-value', format: v => parseFloat(v).toFixed(2) },
            { id: 'scale-z', display: 'scale-z-value', format: v => parseFloat(v).toFixed(2) },
            { id: 'pos-x', display: 'pos-x-value', format: v => parseFloat(v).toFixed(2) },
            { id: 'pos-y', display: 'pos-y-value', format: v => parseFloat(v).toFixed(2) },
            { id: 'pos-z', display: 'pos-z-value', format: v => parseFloat(v).toFixed(2) },
            { id: 'rot-x', display: 'rot-x-value', format: v => `${parseInt(v)}°` },
            { id: 'rot-y', display: 'rot-y-value', format: v => `${parseInt(v)}°` },
            { id: 'rot-z', display: 'rot-z-value', format: v => `${parseInt(v)}°` },
            { id: 'bridge-width', display: 'bridge-width-value', format: v => parseFloat(v).toFixed(3) },
            { id: 'temple-length', display: 'temple-length-value', format: v => parseFloat(v).toFixed(3) },
            { id: 'lens-opacity', display: 'lens-opacity-value', format: v => parseFloat(v).toFixed(2) },
        ];

        sliders.forEach(({ id, display, format }) => {
            const slider = document.getElementById(id);
            const valueEl = document.getElementById(display);
            if (slider && valueEl) {
                slider.addEventListener('input', () => {
                    valueEl.textContent = format(slider.value);
                    this._updatePreviewTransform();
                });
            }
        });
    }

    _setSlider(id, value) {
        const slider = document.getElementById(id);
        if (slider) {
            slider.value = value;
            slider.dispatchEvent(new Event('input'));
        }
    }

    _resetSliderDisplays() {
        // Reset all sliders to default
        this._setSlider('scale-x', 1.0);
        this._setSlider('scale-y', 1.0);
        this._setSlider('scale-z', 1.0);
        this._setSlider('pos-x', 0.0);
        this._setSlider('pos-y', 0.0);
        this._setSlider('pos-z', 0.0);
        this._setSlider('rot-x', 0);
        this._setSlider('rot-y', 0);
        this._setSlider('rot-z', 0);
        this._setSlider('bridge-width', 0.04);
        this._setSlider('temple-length', 0.12);
        this._setSlider('lens-opacity', 0.3);
    }

    // ========================
    // 3D Preview
    // ========================

    _initPreview(file) {
        const section = document.getElementById('preview-section');
        const canvas = document.getElementById('preview-canvas');

        section.style.display = '';

        // Wait for Three.js to be loaded globally if not already
        if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined') {
            console.log('[Admin] Waiting for Three.js library to load for 3D preview...');
            const checkInterval = setInterval(() => {
                if (typeof THREE !== 'undefined' && typeof THREE.GLTFLoader !== 'undefined') {
                    clearInterval(checkInterval);
                    this._initPreview(file);
                }
            }, 50);
            return;
        }

        // Create renderer
        this.previewRenderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: true
        });
        this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.previewRenderer.setSize(canvas.clientWidth, 300);
        this.previewRenderer.setClearColor(0x111111, 1);
        this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;

        // Create scene
        this.previewScene = new THREE.Scene();

        // Lighting
        this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
        dirLight.position.set(1, 2, 3);
        this.previewScene.add(dirLight);
        this.previewScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.4));

        // Camera
        this.previewCamera = new THREE.PerspectiveCamera(45, canvas.clientWidth / 300, 0.01, 100);
        this.previewCamera.position.set(0, 0, 0.5);

        // Controls
        if (THREE.OrbitControls) {
            this.previewControls = new THREE.OrbitControls(this.previewCamera, canvas);
            this.previewControls.enableDamping = true;
            this.previewControls.dampingFactor = 0.1;
        }

        // Load model
        const loader = new THREE.GLTFLoader();
        const url = URL.createObjectURL(file);

        loader.load(url, (gltf) => {
            this.previewModel = gltf.scene;

            // Auto-scale to fit view
            const box = new THREE.Box3().setFromObject(this.previewModel);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) {
                const scale = 0.2 / maxDim;
                this.previewModel.scale.setScalar(scale);
            }

            // Center
            const center = box.getCenter(new THREE.Vector3());
            this.previewModel.position.sub(center.multiplyScalar(this.previewModel.scale.x));

            this.previewScene.add(this.previewModel);
            URL.revokeObjectURL(url);
        }, undefined, (error) => {
            console.error('Preview load error:', error);
            URL.revokeObjectURL(url);
        });

        // Animate
        const animate = () => {
            this.previewAnimId = requestAnimationFrame(animate);
            if (this.previewControls) this.previewControls.update();
            this.previewRenderer.render(this.previewScene, this.previewCamera);
        };
        animate();
    }

    _updatePreviewTransform() {
        if (!this.previewModel) return;

        const sx = parseFloat(document.getElementById('scale-x').value);
        const sy = parseFloat(document.getElementById('scale-y').value);
        const sz = parseFloat(document.getElementById('scale-z').value);

        // Apply relative scale to the auto-scaled model
        const baseScale = this.previewModel.userData.baseScale || this.previewModel.scale.x;
        if (!this.previewModel.userData.baseScale) {
            this.previewModel.userData.baseScale = this.previewModel.scale.x;
        }
        this.previewModel.scale.set(baseScale * sx, baseScale * sy, baseScale * sz);

        const rx = parseFloat(document.getElementById('rot-x').value) * Math.PI / 180;
        const ry = parseFloat(document.getElementById('rot-y').value) * Math.PI / 180;
        const rz = parseFloat(document.getElementById('rot-z').value) * Math.PI / 180;
        this.previewModel.rotation.set(rx, ry, rz);
    }

    _destroyPreview() {
        if (this.previewAnimId) cancelAnimationFrame(this.previewAnimId);
        if (this.previewRenderer) {
            this.previewRenderer.dispose();
            this.previewRenderer = null;
        }
        this.previewScene = null;
        this.previewCamera = null;
        this.previewControls = null;
        this.previewModel = null;
    }

    // ========================
    // Form Submission
    // ========================

    _setupFormActions() {
        const form = document.getElementById('upload-form');
        const cancelBtn = document.getElementById('btn-cancel-upload');

        cancelBtn.addEventListener('click', () => this._clearFile());

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this._submitUpload();
        });
    }

    async _submitUpload() {
        if (!this.selectedFile) {
            this._showToast('Please select a GLB file', 'error');
            return;
        }

        const submitBtn = document.getElementById('btn-submit-upload');
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Uploading...';

        try {
            const metadata = {
                name: document.getElementById('glasses-name').value.trim(),
                category: document.getElementById('glasses-category').value,
                brand: document.getElementById('glasses-brand').value.trim() || null,
                description: document.getElementById('glasses-description').value.trim() || null,
                frame_color: document.getElementById('glasses-frame-color').value.trim() || null,
                scale_x: parseFloat(document.getElementById('scale-x').value),
                scale_y: parseFloat(document.getElementById('scale-y').value),
                scale_z: parseFloat(document.getElementById('scale-z').value),
                position_offset_x: parseFloat(document.getElementById('pos-x').value),
                position_offset_y: parseFloat(document.getElementById('pos-y').value),
                position_offset_z: parseFloat(document.getElementById('pos-z').value),
                rotation_offset_x: parseFloat(document.getElementById('rot-x').value),
                rotation_offset_y: parseFloat(document.getElementById('rot-y').value),
                rotation_offset_z: parseFloat(document.getElementById('rot-z').value),
                bridge_width: parseFloat(document.getElementById('bridge-width').value),
                temple_length: parseFloat(document.getElementById('temple-length').value),
                lens_opacity: parseFloat(document.getElementById('lens-opacity').value),
            };

            if (!metadata.name) {
                this._showToast('Please enter a name for the glasses', 'error');
                return;
            }

            await this.api.uploadGlasses(this.selectedFile, metadata);

            this._showToast('Glasses uploaded successfully!', 'success');
            this._clearFile();
            await this._loadData();
        } catch (error) {
            console.error('Upload failed:', error);
            this._showToast('Upload failed: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '📤 Upload Glasses';
        }
    }

    // ========================
    // Data Loading & Display
    // ========================

    async _loadData() {
        try {
            // Load glasses list
            const result = await this.api.fetchGlasses(null, 0, 200);
            this.glassesList = result.glasses;

            // Load categories
            const categories = await this.api.fetchCategories();

            // Update stats
            document.getElementById('stat-total').textContent = result.total;
            document.getElementById('stat-categories').textContent = categories.length;
            document.getElementById('stat-active').textContent = this.glassesList.filter(g => g.is_active).length;

            const totalSize = this.glassesList.reduce((sum, g) => sum + (g.file_size || 0), 0);
            document.getElementById('stat-size').textContent = this._formatFileSize(totalSize);

            // Render table
            this._renderTable();
        } catch (error) {
            console.error('Failed to load data:', error);
            // Don't show error toast on initial load if server isn't ready yet
        }
    }

    _renderTable() {
        const tbody = document.getElementById('glasses-table-body');

        if (this.glassesList.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
                        No glasses uploaded yet. Use the upload form above.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.glassesList.map(g => `
            <tr data-id="${g.id}">
                <td style="color: var(--text-muted); font-size: 0.8rem;">#${g.id}</td>
                <td class="name-cell">${this._escapeHtml(g.name)}</td>
                <td><span class="category-badge">${g.category}</span></td>
                <td>${g.brand || '—'}</td>
                <td style="font-size: 0.78rem; color: var(--accent-cyan-light);">
                    ${g.scale_x?.toFixed(1)} × ${g.scale_y?.toFixed(1)} × ${g.scale_z?.toFixed(1)}
                </td>
                <td style="font-size: 0.78rem;">
                    ${g.original_filename || '—'}
                    <br><span style="color: var(--text-muted);">${this._formatFileSize(g.file_size || 0)}</span>
                </td>
                <td style="font-size: 0.78rem; color: var(--text-muted);">
                    ${g.created_at ? new Date(g.created_at).toLocaleDateString() : '—'}
                </td>
                <td>
                    <div class="actions-cell">
                        <button class="btn btn-sm" onclick="adminPanel.editGlasses(${g.id})" title="Edit">✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="adminPanel.promptDelete(${g.id})" title="Delete">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // ========================
    // Edit & Delete
    // ========================

    async editGlasses(id) {
        try {
            const glasses = await this.api.fetchGlassesById(id);

            // Scroll to form
            document.querySelector('.upload-section').scrollIntoView({ behavior: 'smooth' });

            // Show form (without file)
            document.getElementById('upload-form').classList.add('visible');
            document.getElementById('glb-upload-zone').style.display = 'none';

            // Fill form
            document.getElementById('glasses-name').value = glasses.name || '';
            document.getElementById('glasses-category').value = glasses.category || 'eyeglasses';
            document.getElementById('glasses-brand').value = glasses.brand || '';
            document.getElementById('glasses-description').value = glasses.description || '';
            document.getElementById('glasses-frame-color').value = glasses.frame_color || '';

            this._setSlider('scale-x', glasses.scale_x || 1);
            this._setSlider('scale-y', glasses.scale_y || 1);
            this._setSlider('scale-z', glasses.scale_z || 1);
            this._setSlider('pos-x', glasses.position_offset_x || 0);
            this._setSlider('pos-y', glasses.position_offset_y || 0);
            this._setSlider('pos-z', glasses.position_offset_z || 0);
            this._setSlider('rot-x', glasses.rotation_offset_x || 0);
            this._setSlider('rot-y', glasses.rotation_offset_y || 0);
            this._setSlider('rot-z', glasses.rotation_offset_z || 0);
            this._setSlider('bridge-width', glasses.bridge_width || 0.04);
            this._setSlider('temple-length', glasses.temple_length || 0.12);
            this._setSlider('lens-opacity', glasses.lens_opacity || 0.3);

            // Change submit button to update mode
            const submitBtn = document.getElementById('btn-submit-upload');
            submitBtn.textContent = '💾 Update Glasses';
            submitBtn.dataset.editId = id;

            // Temporarily override form submit
            const form = document.getElementById('upload-form');
            form.onsubmit = async (e) => {
                e.preventDefault();
                await this._submitUpdate(id);
            };

            this._showToast(`Editing: ${glasses.name}`, 'info');
        } catch (error) {
            this._showToast('Failed to load glasses details', 'error');
        }
    }

    async _submitUpdate(id) {
        const submitBtn = document.getElementById('btn-submit-upload');
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Saving...';

        try {
            const updateData = {
                name: document.getElementById('glasses-name').value.trim(),
                category: document.getElementById('glasses-category').value,
                brand: document.getElementById('glasses-brand').value.trim() || null,
                description: document.getElementById('glasses-description').value.trim() || null,
                frame_color: document.getElementById('glasses-frame-color').value.trim() || null,
                scale_x: parseFloat(document.getElementById('scale-x').value),
                scale_y: parseFloat(document.getElementById('scale-y').value),
                scale_z: parseFloat(document.getElementById('scale-z').value),
                position_offset_x: parseFloat(document.getElementById('pos-x').value),
                position_offset_y: parseFloat(document.getElementById('pos-y').value),
                position_offset_z: parseFloat(document.getElementById('pos-z').value),
                rotation_offset_x: parseFloat(document.getElementById('rot-x').value),
                rotation_offset_y: parseFloat(document.getElementById('rot-y').value),
                rotation_offset_z: parseFloat(document.getElementById('rot-z').value),
                bridge_width: parseFloat(document.getElementById('bridge-width').value),
                temple_length: parseFloat(document.getElementById('temple-length').value),
                lens_opacity: parseFloat(document.getElementById('lens-opacity').value),
            };

            await this.api.updateGlasses(id, updateData);
            this._showToast('Glasses updated successfully!', 'success');
            this._clearFile();

            // Restore form to upload mode
            const form = document.getElementById('upload-form');
            form.onsubmit = null;
            submitBtn.textContent = '📤 Upload Glasses';
            delete submitBtn.dataset.editId;

            await this._loadData();
        } catch (error) {
            this._showToast('Update failed: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
        }
    }

    // ========================
    // Delete Modal
    // ========================

    _setupDeleteModal() {
        document.getElementById('btn-cancel-delete').addEventListener('click', () => {
            document.getElementById('delete-modal').classList.remove('visible');
            this.deleteTargetId = null;
        });

        document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
            if (this.deleteTargetId != null) {
                await this._deleteGlasses(this.deleteTargetId);
            }
        });
    }

    promptDelete(id) {
        this.deleteTargetId = id;
        document.getElementById('delete-modal').classList.add('visible');
    }

    async _deleteGlasses(id) {
        try {
            await this.api.deleteGlasses(id);
            this._showToast('Glasses deleted', 'success');
            document.getElementById('delete-modal').classList.remove('visible');
            this.deleteTargetId = null;
            await this._loadData();
        } catch (error) {
            this._showToast('Delete failed: ' + error.message, 'error');
        }
    }

    // ========================
    // Refresh
    // ========================

    _setupRefresh() {
        document.getElementById('btn-refresh').addEventListener('click', async () => {
            await this._loadData();
            this._showToast('Data refreshed', 'info');
        });
    }

    // ========================
    // Utilities
    // ========================

    _formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;

        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3200);
    }
}

// Initialize on DOM ready
let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
    adminPanel = new AdminPanel();
    adminPanel.init();
});
