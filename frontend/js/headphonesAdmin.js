/**
 * Headphones Admin Panel Controller
 * Handles GLB model upload, metadata management, 3D preview, and CRUD operations.
 */

class HeadphonesAdminPanel {
    constructor() {
        this.api = new HeadphonesAPI();
        this.modelList = [];
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

        if (!zone || !input) return;

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
            if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
                this._handleFileSelected(file);
            } else {
                this._showToast('Please drop a .glb or .gltf file', 'error');
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

        // Show JSON zone
        document.getElementById('json-upload-zone').classList.remove('hidden');

        // Show form
        document.getElementById('upload-form').classList.add('visible');

        // Hide upload zone
        document.getElementById('glb-upload-zone').style.display = 'none';

        // Auto-fill name from filename
        const nameInput = document.getElementById('headphones-name');
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

        if (!zone || !input) return;

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
            if (data.name) document.getElementById('headphones-name').value = data.name;
            if (data.category) document.getElementById('headphones-category').value = data.category;
            if (data.brand) document.getElementById('headphones-brand').value = data.brand;
            if (data.description) document.getElementById('headphones-description').value = data.description;

            // Scale
            if (data.scale_x != null) this._setSlider('scale-x', data.scale_x);
            if (data.scale_y != null) this._setSlider('scale-y', data.scale_y);
            if (data.scale_z != null) this._setSlider('scale-z', data.scale_z);

            // Position offset
            if (data.position_offset_x != null) this._setSlider('pos-x', data.position_offset_x);
            if (data.position_offset_y != null) this._setSlider('pos-y', data.position_offset_y);
            if (data.position_offset_z != null) this._setSlider('pos-z', data.position_offset_z);

            // Rotation offset
            if (data.rotation_offset_x != null) this._setSlider('rot-x', data.rotation_offset_x);
            if (data.rotation_offset_y != null) this._setSlider('rot-y', data.rotation_offset_y);
            if (data.rotation_offset_z != null) this._setSlider('rot-z', data.rotation_offset_z);

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

    _initPreview(file) {
        const section = document.getElementById('preview-section');
        const canvas = document.getElementById('preview-canvas');

        if (!section || !canvas) return;
        section.style.display = '';

        if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined') {
            const checkInterval = setInterval(() => {
                if (typeof THREE !== 'undefined' && typeof THREE.GLTFLoader !== 'undefined') {
                    clearInterval(checkInterval);
                    this._initPreview(file);
                }
            }, 50);
            return;
        }

        // WebGL Renderer
        this.previewRenderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: true
        });
        this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.previewRenderer.setSize(canvas.clientWidth, 300);
        this.previewRenderer.setClearColor(0x111111, 1);
        this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;

        // Scene
        this.previewScene = new THREE.Scene();

        // Lighting
        this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
        dirLight.position.set(1, 2, 3);
        this.previewScene.add(dirLight);

        // Camera
        this.previewCamera = new THREE.PerspectiveCamera(45, canvas.clientWidth / 300, 0.01, 100);
        this.previewCamera.position.set(0, 0, 0.6);

        // Controls
        if (THREE.OrbitControls) {
            this.previewControls = new THREE.OrbitControls(this.previewCamera, canvas);
            this.previewControls.enableDamping = true;
            this.previewControls.dampingFactor = 0.1;
        }

        // Load GLB
        const loader = new THREE.GLTFLoader();
        const url = URL.createObjectURL(file);

        loader.load(url, (gltf) => {
            this.previewModel = gltf.scene;

            // Normalize size in preview scene
            const box = new THREE.Box3().setFromObject(this.previewModel);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) {
                const scale = 0.25 / maxDim;
                this.previewModel.scale.setScalar(scale);
            }

            const center = box.getCenter(new THREE.Vector3());
            this.previewModel.position.sub(center.multiplyScalar(this.previewModel.scale.x));

            this.previewScene.add(this.previewModel);
            URL.revokeObjectURL(url);
        }, undefined, (error) => {
            console.error('Preview load error:', error);
            URL.revokeObjectURL(url);
        });

        // Animation Loop
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

        if (!form || !cancelBtn) return;

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
            this._showToast('Please select a GLB file', 'error');
            return;
        }

        const submitBtn = document.getElementById('btn-submit-upload');
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Uploading...';

        try {
            const metadata = {
                name: document.getElementById('headphones-name').value.trim(),
                category: document.getElementById('headphones-category').value,
                brand: document.getElementById('headphones-brand').value.trim() || null,
                description: document.getElementById('headphones-description').value.trim() || null,
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

            if (!metadata.name) {
                this._showToast('Please enter a name for the model', 'error');
                return;
            }

            await this.api.uploadHeadphones(this.selectedFile, metadata);

            this._showToast('Model uploaded successfully!', 'success');
            this._clearFile();
            await this._loadData();
        } catch (error) {
            console.error('Upload failed:', error);
            this._showToast('Upload failed: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '📤 Upload Gear';
        }
    }

    async _submitUpdate(id) {
        const submitBtn = document.getElementById('btn-submit-upload');
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Saving...';

        try {
            const updateData = {
                name: document.getElementById('headphones-name').value.trim(),
                category: document.getElementById('headphones-category').value,
                brand: document.getElementById('headphones-brand').value.trim() || null,
                description: document.getElementById('headphones-description').value.trim() || null,
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

            await this.api.updateHeadphones(id, updateData);
            this._showToast('Model metadata updated!', 'success');
            this._clearFile();

            // Restore form to upload mode
            const form = document.getElementById('upload-form');
            form.onsubmit = null;
            submitBtn.textContent = '📤 Upload Gear';
            delete submitBtn.dataset.editId;

            await this._loadData();
        } catch (error) {
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
            const result = await this.api.fetchHeadphones(null, 0, 200);
            this.modelList = result.headphones;

            const categories = await this.api.fetchCategories();

            // Stats update
            document.getElementById('stat-total').textContent = result.total;
            document.getElementById('stat-categories').textContent = categories.length;
            document.getElementById('stat-active').textContent = this.modelList.filter(m => m.is_active).length;

            const totalSize = this.modelList.reduce((sum, m) => sum + (m.file_size || 0), 0);
            document.getElementById('stat-size').textContent = this._formatFileSize(totalSize);

            this._renderTable();
        } catch (error) {
            console.error('Failed to load data:', error);
        }
    }

    _renderTable() {
        const tbody = document.getElementById('headphones-table-body');
        if (!tbody) return;

        if (this.modelList.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
                        No models uploaded yet. Use the upload zone above.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.modelList.map(m => `
            <tr data-id="${m.id}">
                <td style="color: var(--text-muted); font-size: 0.8rem;">#${m.id}</td>
                <td class="name-cell">${this._escapeHtml(m.name)}</td>
                <td><span class="category-badge">${m.category}</span></td>
                <td>${m.brand || '—'}</td>
                <td style="font-size: 0.78rem; color: var(--accent-cyan-light);">
                    ${m.scale_x?.toFixed(1)} × ${m.scale_y?.toFixed(1)} × ${m.scale_z?.toFixed(1)}
                </td>
                <td style="font-size: 0.78rem;">
                    ${m.original_filename || '—'}
                    <br><span style="color: var(--text-muted);">${this._formatFileSize(m.file_size || 0)}</span>
                </td>
                <td style="font-size: 0.78rem; color: var(--text-muted);">
                    ${m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                </td>
                <td>
                    <div class="actions-cell">
                        <button class="btn btn-sm" onclick="adminPanel.editModel(${m.id})" title="Edit Metadata">✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="adminPanel.promptDelete(${m.id})" title="Delete">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // ========================
    // Edit & Delete Actions
    // ========================

    async editModel(id) {
        try {
            const modelData = await this.api.fetchHeadphonesById(id);

            // Scroll to Form
            document.querySelector('.upload-section').scrollIntoView({ behavior: 'smooth' });

            document.getElementById('upload-form').classList.add('visible');
            document.getElementById('glb-upload-zone').style.display = 'none';

            // Fill form fields
            document.getElementById('headphones-name').value = modelData.name || '';
            document.getElementById('headphones-category').value = modelData.category || 'headphone';
            document.getElementById('headphones-brand').value = modelData.brand || '';
            document.getElementById('headphones-description').value = modelData.description || '';

            this._setSlider('scale-x', modelData.scale_x || 1);
            this._setSlider('scale-y', modelData.scale_y || 1);
            this._setSlider('scale-z', modelData.scale_z || 1);
            this._setSlider('pos-x', modelData.position_offset_x || 0);
            this._setSlider('pos-y', modelData.position_offset_y || 0);
            this._setSlider('pos-z', modelData.position_offset_z || 0);
            this._setSlider('rot-x', modelData.rotation_offset_x || 0);
            this._setSlider('rot-y', modelData.rotation_offset_y || 0);
            this._setSlider('rot-z', modelData.rotation_offset_z || 0);

            // Toggle submit btn state
            const submitBtn = document.getElementById('btn-submit-upload');
            submitBtn.textContent = '💾 Save Metadata';
            submitBtn.dataset.editId = id;

            this._showToast(`Editing: ${modelData.name}`, 'info');
        } catch (error) {
            console.error(error);
            this._showToast('Failed to load item details', 'error');
        }
    }

    _setupDeleteModal() {
        const cancel = document.getElementById('btn-cancel-delete');
        const confirm = document.getElementById('btn-confirm-delete');

        if (!cancel || !confirm) return;

        cancel.addEventListener('click', () => {
            document.getElementById('delete-modal').classList.remove('visible');
            this.deleteTargetId = null;
        });

        confirm.addEventListener('click', async () => {
            if (this.deleteTargetId != null) {
                await this._deleteModel(this.deleteTargetId);
            }
        });
    }

    promptDelete(id) {
        this.deleteTargetId = id;
        document.getElementById('delete-modal').classList.add('visible');
    }

    async _deleteModel(id) {
        try {
            await this.api.deleteHeadphones(id);
            this._showToast('Model removed successfully', 'success');
            document.getElementById('delete-modal').classList.remove('visible');
            this.deleteTargetId = null;
            await this._loadData();
        } catch (error) {
            this._showToast('Delete failed: ' + error.message, 'error');
        }
    }

    _setupRefresh() {
        const btn = document.getElementById('btn-refresh');
        if (btn) {
            btn.addEventListener('click', async () => {
                await this._loadData();
                this._showToast('Gallery refreshed', 'info');
            });
        }
    }

    // ========================
    // Helper Methods
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
        if (!container) return;
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

let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
    adminPanel = new HeadphonesAdminPanel();
    window.adminPanel = adminPanel;
    adminPanel.init();
});
