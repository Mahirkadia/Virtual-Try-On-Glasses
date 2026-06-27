/**
 * Jewelry Admin Panel Controller
 * Handles GLB upload, metadata management, 3D preview, and CRUD operations
 */

class JewelryAdminPanel {
    constructor() {
        this.api = new JewelryAPI();
        this.jewelryList = [];
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
        this._setupCategoryChange();
        await this._loadData();
    }

    // ========================
    // Upload Zone Setup
    // ========================

    _setupUploadZone() {
        const zone = document.getElementById('glb-upload-zone');
        const input = document.getElementById('glb-file-input');

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
            if (file && file.name.endsWith('.glb')) {
                this._handleFileSelected(file);
            } else {
                this._showToast('Please drop a valid .glb file', 'error');
            }
        });

        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this._handleFileSelected(e.target.files[0]);
            }
        });

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

        // Show optional JSON metadata loader
        document.getElementById('json-upload-zone').classList.remove('hidden');

        // Show form
        document.getElementById('upload-form').classList.add('visible');

        // Hide upload zone
        document.getElementById('glb-upload-zone').style.display = 'none';

        // Auto-fill name from filename
        const nameInput = document.getElementById('jewelry-name');
        if (!nameInput.value) {
            nameInput.value = file.name.replace(/\.glb$/i, '').replace(/[-_]/g, ' ');
        }

        // Show 3D preview
        this._initPreview(file);

        this._showToast('Model selected: ' + file.name, 'success');
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

        // Restore upload zone status
        const jsonZone = document.getElementById('json-upload-zone');
        jsonZone.classList.remove('loaded');
        jsonZone.querySelector('span').textContent = '📋 Drop JSON metadata file here (optional)';

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

            // Fill text fields
            if (data.name) document.getElementById('jewelry-name').value = data.name;
            if (data.category) document.getElementById('jewelry-category').value = data.category;
            if (data.brand) document.getElementById('jewelry-brand').value = data.brand;
            if (data.description) document.getElementById('jewelry-description').value = data.description;
            if (data.material) document.getElementById('jewelry-material').value = data.material;

            // Scale
            if (data.scale_x != null) this._setSlider('scale-x', data.scale_x);
            if (data.scale_y != null) this._setSlider('scale-y', data.scale_y);
            if (data.scale_z != null) this._setSlider('scale-z', data.scale_z);

            // Position
            if (data.position_offset_x != null) this._setSlider('pos-x', data.position_offset_x);
            if (data.position_offset_y != null) this._setSlider('pos-y', data.position_offset_y);
            if (data.position_offset_z != null) this._setSlider('pos-z', data.position_offset_z);

            // Rotation
            if (data.rotation_offset_x != null) this._setSlider('rot-x', data.rotation_offset_x);
            if (data.rotation_offset_y != null) this._setSlider('rot-y', data.rotation_offset_y);
            if (data.rotation_offset_z != null) this._setSlider('rot-z', data.rotation_offset_z);

            // Visual indicator
            zone.classList.add('loaded');
            zone.querySelector('span').textContent = `✅ Loaded: ${file.name}`;
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
            { id: 'rot-z', display: 'rot-z-value', format: v => `${parseInt(v)}°` }
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
        this._setSlider('scale-x', 1.0);
        this._setSlider('scale-y', 1.0);
        this._setSlider('scale-z', 1.0);
        this._setSlider('pos-x', 0.0);
        this._setSlider('pos-y', 0.0);
        this._setSlider('pos-z', 0.0);
        this._setSlider('rot-x', 0);
        this._setSlider('rot-y', 0);
        this._setSlider('rot-z', 0);
    }

    // ========================
    // 3D Preview
    // ========================

    _initPreview(fileOrUrl) {
        const section = document.getElementById('preview-section');
        const canvas = document.getElementById('preview-canvas');

        section.style.display = '';

        if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined') {
            console.log('[Admin] Waiting for Three.js module to be ready...');
            const interval = setInterval(() => {
                if (typeof THREE !== 'undefined' && typeof THREE.GLTFLoader !== 'undefined') {
                    clearInterval(interval);
                    this._initPreview(fileOrUrl);
                }
            }, 50);
            return;
        }

        // Cleanup if existing
        this._destroyPreview();

        this.previewRenderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: false
        });
        this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.previewRenderer.setSize(canvas.clientWidth, 350);
        this.previewRenderer.setClearColor(0x0a0a0f, 1);
        this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;

        this.previewScene = new THREE.Scene();

        // Grid helper to visualize bounds and centering
        const gridHelper = new THREE.GridHelper(2, 20, 0xc5a880, 0x22222a);
        gridHelper.position.y = -0.5;
        this.previewScene.add(gridHelper);

        // Guide Cylinder (Knuckle guide representing finger tracking anchor)
        const radius = 0.28;

        const cylinderGeom = new THREE.CylinderGeometry(radius, radius, 1.8, 32);
        const cylinderMat = new THREE.MeshBasicMaterial({
            color: 0x45f3ff,
            transparent: true,
            opacity: 0.2,
            wireframe: true
        });
        const guideCylinder = new THREE.Mesh(cylinderGeom, cylinderMat);
        guideCylinder.name = "guideCylinder";
        this.previewScene.add(guideCylinder);

        // Lighting
        this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(2, 4, 3);
        this.previewScene.add(dirLight);

        this.previewCamera = new THREE.PerspectiveCamera(45, canvas.clientWidth / 350, 0.01, 100);
        this.previewCamera.position.set(0, 0.5, 1.8);

        if (THREE.OrbitControls) {
            this.previewControls = new THREE.OrbitControls(this.previewCamera, canvas);
            this.previewControls.enableDamping = true;
            this.previewControls.dampingFactor = 0.1;
        }

        // Load GLB
        const loader = new THREE.GLTFLoader();
        let url;
        if (fileOrUrl instanceof File) {
            url = URL.createObjectURL(fileOrUrl);
        } else {
            url = fileOrUrl;
        }

        loader.load(url, (gltf) => {
            this.previewModel = gltf.scene;

            // Auto-center and fit to a bounding box
            const box = new THREE.Box3().setFromObject(this.previewModel);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            // Sort bounding box dimensions
            const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
            let baseScale = 1.0;
            
            // TARGET_SIZE matches the try-on scale exactly: 1.26 units
            const TARGET_SIZE = 1.26;

            if (category === 'ring') {
                const ringDiameter = (dims[1] + dims[2]) / 2;
                if (ringDiameter > 0) {
                    baseScale = TARGET_SIZE / ringDiameter;
                }
            } else {
                const maxDim = dims[2];
                if (maxDim > 0) {
                    baseScale = TARGET_SIZE / maxDim;
                }
            }

            this.previewModel.scale.setScalar(baseScale);
            this.previewModel.userData.baseScale = baseScale;
            this.previewModel.userData.center = center;
            this.previewModel.userData.rawSize = size.clone();

            // Center relative to origin
            this.previewModel.position.set(
                -center.x * baseScale,
                -center.y * baseScale,
                -center.z * baseScale
            );

            // Wrap in a group to act as a container
            const pivot = new THREE.Group();
            pivot.add(this.previewModel);
            this.previewScene.add(pivot);
            this.previewPivotGroup = pivot;

            if (fileOrUrl instanceof File) {
                URL.revokeObjectURL(url);
            }
            this._updatePreviewTransform();
        }, undefined, (error) => {
            console.error('[Admin] Preview model load failed:', error);
            this._showToast('Preview load error. GLB may be corrupted.', 'error');
            if (fileOrUrl instanceof File) {
                URL.revokeObjectURL(url);
            }
        });

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

        const baseScale = this.previewModel.userData.baseScale;
        const center = this.previewModel.userData.center;
        const rawSize = this.previewModel.userData.rawSize;

        // Apply scale: baseScale * offset_scale
        this.previewModel.scale.set(baseScale * sx, baseScale * sy, baseScale * sz);

        // Auto-detect ring/bracelet hole axis based on smallest bounding box dimension
        let autoRx = 0;
        let autoRy = 0;
        let autoRz = 0;

        const category = document.getElementById('jewelry-category').value;
        if ((category === 'ring' || category === 'bracelet') && rawSize) {
            if (rawSize.x < rawSize.y && rawSize.x < rawSize.z) {
                // Hole is along X-axis. Rotate 90 degrees around Z to align X with Y.
                autoRz = 90 * Math.PI / 180;
            } else if (rawSize.y < rawSize.x && rawSize.y < rawSize.z) {
                // Hole is along Y-axis. Already aligned!
                autoRx = 0;
            } else {
                // Hole is along Z-axis. Rotate 90 degrees around X to align Z with Y.
                autoRx = 90 * Math.PI / 180;
            }
        }

        // Apply combined rotation (auto-alignment + metadata offsets)
        const qAuto = new THREE.Quaternion().setFromEuler(new THREE.Euler(autoRx, autoRy, autoRz));
        const rx = parseFloat(document.getElementById('rot-x').value) * Math.PI / 180;
        const ry = parseFloat(document.getElementById('rot-y').value) * Math.PI / 180;
        const rz = parseFloat(document.getElementById('rot-z').value) * Math.PI / 180;
        const qMeta = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
        const qFinal = qAuto.clone().multiply(qMeta);
        this.previewModel.quaternion.copy(qFinal);

        // Apply position: -center * baseScale + offset_pos
        const px = parseFloat(document.getElementById('pos-x').value);
        const py = parseFloat(document.getElementById('pos-y').value);
        const pz = parseFloat(document.getElementById('pos-z').value);
        this.previewModel.position.set(
            -center.x * baseScale + px,
            -center.y * baseScale + py,
            -center.z * baseScale + pz
        );

        // Keep parent pivot group at default identity transforms
        if (this.previewPivotGroup) {
            this.previewPivotGroup.position.set(0, 0, 0);
            this.previewPivotGroup.rotation.set(0, 0, 0);
        }
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
        this.previewPivotGroup = null;
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
            const submitBtn = document.getElementById('btn-submit-upload');
            if (submitBtn.dataset.editId) {
                await this._submitUpdate(parseInt(submitBtn.dataset.editId));
            } else {
                await this._submitUpload();
            }
        });
    }

    async _submitUpload() {
        if (!this.selectedFile) {
            this._showToast('Please select a GLB file first', 'error');
            return;
        }

        const submitBtn = document.getElementById('btn-submit-upload');
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Uploading...';

        try {
            const materialVal = document.getElementById('jewelry-material').value.trim();
            const descVal = document.getElementById('jewelry-description').value.trim();
            
            // Combine material details into description for storage consistency
            let finalDesc = descVal;
            if (materialVal) {
                finalDesc = `Material: ${materialVal}. ${descVal}`;
            }

            const metadata = {
                name: document.getElementById('jewelry-name').value.trim(),
                category: document.getElementById('jewelry-category').value,
                brand: document.getElementById('jewelry-brand').value.trim() || null,
                description: finalDesc || null,
                scale_x: parseFloat(document.getElementById('scale-x').value),
                scale_y: parseFloat(document.getElementById('scale-y').value),
                scale_z: parseFloat(document.getElementById('scale-z').value),
                position_offset_x: parseFloat(document.getElementById('pos-x').value),
                position_offset_y: parseFloat(document.getElementById('pos-y').value),
                position_offset_z: parseFloat(document.getElementById('pos-z').value),
                rotation_offset_x: parseFloat(document.getElementById('rot-x').value),
                rotation_offset_y: parseFloat(document.getElementById('rot-y').value),
                rotation_offset_z: parseFloat(document.getElementById('rot-z').value),
            };

            await this.api.uploadJewelry(this.selectedFile, metadata);

            this._showToast('Jewelry piece uploaded successfully!', 'success');
            this._clearFile();
            await this._loadData();
        } catch (error) {
            console.error('Upload failed:', error);
            this._showToast('Upload failed: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '📤 Upload Product';
        }
    }

    async editJewelry(id) {
        try {
            const item = await this.api.fetchJewelryById(id);

            // Scroll to form view smoothly
            document.querySelector('.upload-section').scrollIntoView({ behavior: 'smooth' });

            // Render form view
            document.getElementById('upload-form').classList.add('visible');
            document.getElementById('glb-upload-zone').style.display = 'none';

            // Populate form fields
            document.getElementById('jewelry-name').value = item.name || '';
            document.getElementById('jewelry-category').value = item.category || 'ring';
            document.getElementById('jewelry-brand').value = item.brand || '';
            
            // Extract material prefix from description if present
            let desc = item.description || '';
            let material = '';
            if (desc.startsWith('Material: ')) {
                const match = desc.match(/^Material:\s*([^.]+)\.\s*(.*)/s);
                if (match) {
                    material = match[1];
                    desc = match[2];
                }
            }
            document.getElementById('jewelry-material').value = material;
            document.getElementById('jewelry-description').value = desc;

            // Load slider parameters
            this._setSlider('scale-x', item.scale_x ?? 1.0);
            this._setSlider('scale-y', item.scale_y ?? 1.0);
            this._setSlider('scale-z', item.scale_z ?? 1.0);
            this._setSlider('pos-x', item.position_offset_x ?? 0.0);
            this._setSlider('pos-y', item.position_offset_y ?? 0.0);
            this._setSlider('pos-z', item.position_offset_z ?? 0.0);
            this._setSlider('rot-x', item.rotation_offset_x ?? 0);
            this._setSlider('rot-y', item.rotation_offset_y ?? 0);
            this._setSlider('rot-z', item.rotation_offset_z ?? 0);

            // Change button to Edit mode
            const submitBtn = document.getElementById('btn-submit-upload');
            submitBtn.textContent = '💾 Save Jewelry Details';
            submitBtn.dataset.editId = id;

            // Load model into preview window from the backend
            const modelUrl = this.api.getModelUrl(id);
            this._initPreview(modelUrl);

            this._showToast(`Editing: ${item.name}`, 'info');
        } catch (error) {
            console.error('Failed to load item:', error);
            this._showToast('Failed to load product details', 'error');
        }
    }

    async _submitUpdate(id) {
        const submitBtn = document.getElementById('btn-submit-upload');
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Saving...';

        try {
            const materialVal = document.getElementById('jewelry-material').value.trim();
            const descVal = document.getElementById('jewelry-description').value.trim();
            
            let finalDesc = descVal;
            if (materialVal) {
                finalDesc = `Material: ${materialVal}. ${descVal}`;
            }

            const updateData = {
                name: document.getElementById('jewelry-name').value.trim(),
                category: document.getElementById('jewelry-category').value,
                brand: document.getElementById('jewelry-brand').value.trim() || null,
                description: finalDesc || null,
                scale_x: parseFloat(document.getElementById('scale-x').value),
                scale_y: parseFloat(document.getElementById('scale-y').value),
                scale_z: parseFloat(document.getElementById('scale-z').value),
                position_offset_x: parseFloat(document.getElementById('pos-x').value),
                position_offset_y: parseFloat(document.getElementById('pos-y').value),
                position_offset_z: parseFloat(document.getElementById('pos-z').value),
                rotation_offset_x: parseFloat(document.getElementById('rot-x').value),
                rotation_offset_y: parseFloat(document.getElementById('rot-y').value),
                rotation_offset_z: parseFloat(document.getElementById('rot-z').value)
            };

            await this.api.updateJewelry(id, updateData);
            this._showToast('Jewelry item updated successfully!', 'success');
            
            // Revert form states
            this._clearFile();
            submitBtn.textContent = '📤 Upload Product';
            delete submitBtn.dataset.editId;

            await this._loadData();
        } catch (error) {
            console.error('Update failed:', error);
            this._showToast('Update failed: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
        }
    }

    // ========================
    // Data Loading & Display
    // ========================

    async _loadData() {
        try {
            const result = await this.api.fetchJewelry(null, 0, 200);
            this.jewelryList = result.jewelry;

            const categories = await this.api.fetchCategories();

            // Refresh stats counters
            document.getElementById('stat-total').textContent = result.total;
            document.getElementById('stat-categories').textContent = categories.length;
            document.getElementById('stat-active').textContent = this.jewelryList.filter(j => j.is_active).length;

            const totalBytes = this.jewelryList.reduce((sum, j) => sum + (j.file_size || 0), 0);
            document.getElementById('stat-size').textContent = this._formatFileSize(totalBytes);

            this._renderTable();
        } catch (error) {
            console.error('Data reload failed:', error);
        }
    }

    _renderTable() {
        const tbody = document.getElementById('jewelry-table-body');

        if (this.jewelryList.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
                        No jewelry products uploaded yet. Select a .glb file above to begin.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.jewelryList.map(j => {
            const dateStr = j.created_at ? new Date(j.created_at).toLocaleDateString() : '—';
            
            return `
                <tr data-id="${j.id}">
                    <td style="color: var(--text-muted); font-size: 0.8rem;">#${j.id}</td>
                    <td class="name-cell">${this._escapeHtml(j.name)}</td>
                    <td><span class="category-badge">${j.category}</span></td>
                    <td>${j.brand || '—'}</td>
                    <td style="font-size: 0.78rem; line-height: 1.3;">
                        Scale: ${j.scale_x?.toFixed(2)} × ${j.scale_y?.toFixed(2)} × ${j.scale_z?.toFixed(2)}<br>
                        Pos: [${j.position_offset_x?.toFixed(2)}, ${j.position_offset_y?.toFixed(2)}, ${j.position_offset_z?.toFixed(2)}]<br>
                        Rot: [${j.rotation_offset_x?.toFixed(0)}°, ${j.rotation_offset_y?.toFixed(0)}°, ${j.rotation_offset_z?.toFixed(0)}°]
                    </td>
                    <td style="font-size: 0.78rem; line-height: 1.3;">
                        ${this._escapeHtml(j.original_filename)}<br>
                        <span style="color: var(--text-muted);">${this._formatFileSize(j.file_size || 0)}</span>
                    </td>
                    <td style="font-size: 0.78rem; color: var(--text-muted);">${dateStr}</td>
                    <td>
                        <div class="actions-cell">
                            <button class="btn btn-sm" onclick="adminPanel.editJewelry(${j.id})" title="Edit Details">✏️</button>
                            <button class="btn btn-sm btn-danger" onclick="adminPanel.promptDelete(${j.id})" title="Delete Piece">🗑️</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ========================
    // Delete Modal Actions
    // ========================

    _setupDeleteModal() {
        document.getElementById('btn-cancel-delete').addEventListener('click', () => {
            document.getElementById('delete-modal').classList.remove('visible');
            this.deleteTargetId = null;
        });

        document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
            if (this.deleteTargetId != null) {
                await this._deleteJewelry(this.deleteTargetId);
            }
        });
    }

    promptDelete(id) {
        this.deleteTargetId = id;
        document.getElementById('delete-modal').classList.add('visible');
    }

    async _deleteJewelry(id) {
        try {
            await this.api.deleteJewelry(id);
            this._showToast('Product deleted successfully', 'success');
            document.getElementById('delete-modal').classList.remove('visible');
            this.deleteTargetId = null;
            await this._loadData();
        } catch (error) {
            console.error('Delete failed:', error);
            this._showToast('Delete failed: ' + error.message, 'error');
        }
    }

    // ========================
    // Refresh & Utilities
    // ========================

    _setupRefresh() {
        document.getElementById('btn-refresh').addEventListener('click', async () => {
            await this._loadData();
            this._showToast('Catalog refreshed', 'info');
        });
    }

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

        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;

        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3200);
    }
    _setupCategoryChange() {
        document.getElementById('jewelry-category').addEventListener('change', () => {
            if (this.previewScene) {
                const existingGuide = this.previewScene.getObjectByName("guideCylinder");
                if (existingGuide) {
                    this.previewScene.remove(existingGuide);
                    existingGuide.geometry.dispose();
                    existingGuide.material.dispose();
                }
                const radius = 0.28;

                const cylinderGeom = new THREE.CylinderGeometry(radius, radius, 1.8, 32);
                const cylinderMat = new THREE.MeshBasicMaterial({
                    color: 0x45f3ff,
                    transparent: true,
                    opacity: 0.2,
                    wireframe: true
                });
                const guideCylinder = new THREE.Mesh(cylinderGeom, cylinderMat);
                guideCylinder.name = "guideCylinder";
                this.previewScene.add(guideCylinder);
            }
        });
    }
}

// Instantiate on Dom ready
let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
    adminPanel = new JewelryAdminPanel();
    adminPanel.init();
});
