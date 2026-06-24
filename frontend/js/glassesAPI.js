/**
 * GlassesAPI - Client for communicating with the FastAPI backend.
 * Handles CRUD operations for glasses models, file uploads, and categories.
 *
 * Usage:
 *   const api = new GlassesAPI();
 *   const result = await api.fetchGlasses('sunglasses', 0, 20);
 *   const glasses = await api.fetchGlassesById(1);
 *   const modelUrl = api.getModelUrl(1);
 */
class GlassesAPI {
    /**
     * @param {string} [baseUrl=''] - Base URL for the API. Defaults to current origin.
     */
    constructor(baseUrl = '') {
        /** @type {string} */
        this.baseUrl = baseUrl || window.location.origin;

        // Remove trailing slash
        if (this.baseUrl.endsWith('/')) {
            this.baseUrl = this.baseUrl.slice(0, -1);
        }
    }

    /**
     * Fetch a paginated list of glasses, optionally filtered by category.
     * @param {string|null} [category=null] - Filter by category (null for all)
     * @param {number} [skip=0] - Number of items to skip
     * @param {number} [limit=50] - Maximum items to return
     * @returns {Promise<{ glasses: Array, total: number }>}
     */
    async fetchGlasses(category = null, skip = 0, limit = 50) {
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        params.set('skip', String(skip));
        params.set('limit', String(limit));

        const queryStr = params.toString();
        const url = `${this.baseUrl}/api/glasses/${queryStr ? '?' + queryStr : ''}`;

        const data = await this._fetch(url);

        // API may return the list directly or wrapped in an object
        if (Array.isArray(data)) {
            return { glasses: data, total: data.length };
        }

        return {
            glasses: data.glasses || data.items || data.results || [],
            total: data.total !== undefined ? data.total : (data.glasses || data.items || data.results || []).length
        };
    }

    /**
     * Fetch a single glasses item by ID.
     * @param {number|string} id - Glasses ID
     * @returns {Promise<object>}
     */
    async fetchGlassesById(id) {
        const url = `${this.baseUrl}/api/glasses/${encodeURIComponent(id)}`;
        return await this._fetch(url);
    }

    /**
     * Fetch all available categories with their item counts.
     * @returns {Promise<Array<{ category: string, count: number }>>}
     */
    async fetchCategories() {
        const url = `${this.baseUrl}/api/glasses/categories`;

        try {
            const data = await this._fetch(url);

            // Normalize response format
            if (Array.isArray(data)) {
                return data.map(item => {
                    if (typeof item === 'string') {
                        return { category: item, count: 0 };
                    }
                    return {
                        category: item.category || item.name || item,
                        count: item.count || 0
                    };
                });
            }

            return [];
        } catch (err) {
            console.warn('[GlassesAPI] Failed to fetch categories:', err.message);
            return [];
        }
    }

    /**
     * Upload a new glasses model with metadata.
     * @param {File} glbFile - The GLB file to upload
     * @param {object} metadata - Glasses metadata (name, category, etc.)
     * @returns {Promise<object>} - The created glasses object
     */
    async uploadGlasses(glbFile, metadata) {
        if (!glbFile || !(glbFile instanceof File)) {
            throw new Error('A valid File object is required for upload.');
        }

        const url = `${this.baseUrl}/api/glasses/upload`;

        const formData = new FormData();
        formData.append('file', glbFile, glbFile.name);
        formData.append('metadata', JSON.stringify(metadata));

        const response = await fetch(url, {
            method: 'POST',
            body: formData
            // Note: Do NOT set Content-Type header; browser sets it with boundary
        });

        if (!response.ok) {
            await this._handleErrorResponse(response);
        }

        return await response.json();
    }

    /**
     * Update glasses metadata.
     * @param {number|string} id - Glasses ID
     * @param {object} updateData - Partial update data
     * @returns {Promise<object>} - Updated glasses object
     */
    async updateGlasses(id, updateData) {
        const url = `${this.baseUrl}/api/glasses/${encodeURIComponent(id)}`;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });

        if (!response.ok) {
            await this._handleErrorResponse(response);
        }

        return await response.json();
    }

    /**
     * Update the GLB file for an existing glasses entry.
     * @param {number|string} id - Glasses ID
     * @param {File} glbFile - The new GLB file
     * @returns {Promise<object>}
     */
    async updateGlassesFile(id, glbFile) {
        if (!glbFile || !(glbFile instanceof File)) {
            throw new Error('A valid File object is required for file update.');
        }

        const url = `${this.baseUrl}/api/glasses/${encodeURIComponent(id)}/file`;

        const formData = new FormData();
        formData.append('file', glbFile, glbFile.name);

        const response = await fetch(url, {
            method: 'PUT',
            body: formData
        });

        if (!response.ok) {
            await this._handleErrorResponse(response);
        }

        return await response.json();
    }

    /**
     * Delete a glasses entry.
     * @param {number|string} id - Glasses ID
     * @returns {Promise<object>}
     */
    async deleteGlasses(id) {
        const url = `${this.baseUrl}/api/glasses/${encodeURIComponent(id)}`;

        const response = await fetch(url, {
            method: 'DELETE'
        });

        if (!response.ok) {
            await this._handleErrorResponse(response);
        }

        // Some DELETE endpoints return 204 No Content
        if (response.status === 204) {
            return { success: true };
        }

        return await response.json();
    }

    /**
     * Get the full URL for downloading a glasses model.
     * @param {number|string} id - Glasses ID
     * @returns {string}
     */
    getModelUrl(id) {
        return `${this.baseUrl}/api/glasses/${encodeURIComponent(id)}/model`;
    }

    /**
     * Get the full URL for a glasses thumbnail/preview image.
     * @param {number|string} id - Glasses ID
     * @returns {string}
     */
    getThumbnailUrl(id) {
        return `${this.baseUrl}/api/glasses/${encodeURIComponent(id)}/thumbnail`;
    }

    /**
     * Health check / ping the API.
     * @returns {Promise<boolean>}
     */
    async ping() {
        try {
            const response = await fetch(`${this.baseUrl}/api/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Internal fetch wrapper with error handling and JSON parsing.
     * @param {string} url - Full URL to fetch
     * @param {object} [options={}] - Fetch options
     * @returns {Promise<*>} - Parsed JSON response
     * @private
     */
    async _fetch(url, options = {}) {
        const defaultOptions = {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        };

        const mergedOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...(options.headers || {})
            }
        };

        let response;

        try {
            response = await fetch(url, mergedOptions);
        } catch (err) {
            // Network error (offline, CORS, etc.)
            if (err.name === 'TypeError') {
                throw new Error(
                    'Network error: Unable to connect to the server. ' +
                    'Please check your internet connection and try again.'
                );
            }
            throw err;
        }

        if (!response.ok) {
            await this._handleErrorResponse(response);
        }

        // Handle empty responses
        const contentType = response.headers.get('content-type');
        if (
            response.status === 204 ||
            !contentType ||
            !contentType.includes('application/json')
        ) {
            return {};
        }

        try {
            return await response.json();
        } catch {
            throw new Error(`Invalid JSON response from ${url}`);
        }
    }

    /**
     * Handle HTTP error responses with user-friendly messages.
     * @param {Response} response - The fetch Response object
     * @private
     */
    async _handleErrorResponse(response) {
        let errorMessage;

        try {
            const errorData = await response.json();
            errorMessage = errorData.detail || errorData.message || errorData.error || JSON.stringify(errorData);
        } catch {
            errorMessage = response.statusText || 'Unknown error';
        }

        switch (response.status) {
            case 400:
                throw new Error(`Bad request: ${errorMessage}`);
            case 401:
                throw new Error('Unauthorized: Please log in to continue.');
            case 403:
                throw new Error('Forbidden: You do not have permission for this action.');
            case 404:
                throw new Error(`Not found: ${errorMessage}`);
            case 409:
                throw new Error(`Conflict: ${errorMessage}`);
            case 413:
                throw new Error('File too large: Please upload a smaller file.');
            case 422:
                throw new Error(`Validation error: ${errorMessage}`);
            case 429:
                throw new Error('Too many requests: Please slow down and try again.');
            case 500:
                throw new Error('Server error: Something went wrong. Please try again later.');
            case 502:
            case 503:
                throw new Error('Service unavailable: The server is temporarily down. Please try again later.');
            default:
                throw new Error(`API error (${response.status}): ${errorMessage}`);
        }
    }
}
