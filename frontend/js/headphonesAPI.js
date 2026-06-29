/**
 * HeadphonesAPI - Client for communicating with the FastAPI backend.
 * Handles CRUD operations for headphones models, file uploads, and categories.
 */
class HeadphonesAPI {
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
     * Fetch a paginated list of headphones, optionally filtered by category.
     * @param {string|null} [category=null] - Filter by category (null for all)
     * @param {number} [skip=0] - Number of items to skip
     * @param {number} [limit=50] - Maximum items to return
     * @returns {Promise<{ headphones: Array, total: number }>}
     */
    async fetchHeadphones(category = null, skip = 0, limit = 50) {
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        params.set('skip', String(skip));
        params.set('limit', String(limit));

        const queryStr = params.toString();
        const url = `${this.baseUrl}/api/headphones/${queryStr ? '?' + queryStr : ''}`;

        const data = await this._fetch(url);

        if (Array.isArray(data)) {
            return { headphones: data, total: data.length };
        }

        return {
            headphones: data.headphones || data.items || data.results || [],
            total: data.total !== undefined ? data.total : (data.headphones || data.items || data.results || []).length
        };
    }

    /**
     * Fetch a single headphones item by ID.
     * @param {number|string} id - Headphones ID
     * @returns {Promise<object>}
     */
    async fetchHeadphonesById(id) {
        const url = `${this.baseUrl}/api/headphones/${encodeURIComponent(id)}`;
        return await this._fetch(url);
    }

    /**
     * Fetch all available headphones categories with their item counts.
     * @returns {Promise<Array<{ category: string, count: number }>>}
     */
    async fetchCategories() {
        const url = `${this.baseUrl}/api/headphones/categories`;

        try {
            const data = await this._fetch(url);

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
            console.warn('[HeadphonesAPI] Failed to fetch categories:', err.message);
            return [];
        }
    }

    /**
     * Upload a new headphones model with metadata.
     * @param {File} glbFile - The GLB file to upload
     * @param {object} metadata - Headphones metadata (name, category, etc.)
     * @returns {Promise<object>} - The created headphones object
     */
    async uploadHeadphones(glbFile, metadata) {
        if (!glbFile || !(glbFile instanceof File)) {
            throw new Error('A valid File object is required for upload.');
        }

        const url = `${this.baseUrl}/api/headphones/upload`;

        const formData = new FormData();
        formData.append('file', glbFile, glbFile.name);
        formData.append('metadata', JSON.stringify(metadata));

        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            await this._handleErrorResponse(response);
        }

        return await response.json();
    }

    /**
     * Update headphones metadata.
     * @param {number|string} id - Headphones ID
     * @param {object} updateData - Partial update data
     * @returns {Promise<object>} - Updated headphones object
     */
    async updateHeadphones(id, updateData) {
        const url = `${this.baseUrl}/api/headphones/${encodeURIComponent(id)}`;

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
     * Update the GLB file for an existing headphones entry.
     * @param {number|string} id - Headphones ID
     * @param {File} glbFile - The new GLB file
     * @returns {Promise<object>}
     */
    async updateHeadphonesFile(id, glbFile) {
        if (!glbFile || !(glbFile instanceof File)) {
            throw new Error('A valid File object is required for file update.');
        }

        const url = `${this.baseUrl}/api/headphones/${encodeURIComponent(id)}/file`;

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
     * Delete a headphones entry.
     * @param {number|string} id - Headphones ID
     * @returns {Promise<object>}
     */
    async deleteHeadphones(id) {
        const url = `${this.baseUrl}/api/headphones/${encodeURIComponent(id)}`;

        const response = await fetch(url, {
            method: 'DELETE'
        });

        if (!response.ok) {
            await this._handleErrorResponse(response);
        }

        if (response.status === 204) {
            return { success: true };
        }

        return await response.json();
    }

    /**
     * Get the full URL for downloading a headphones model.
     * @param {number|string} id - Headphones ID
     * @returns {string}
     */
    getModelUrl(id) {
        return `${this.baseUrl}/api/headphones/${encodeURIComponent(id)}/model`;
    }

    /**
     * Get the full URL for a headphones thumbnail/preview image.
     * @param {number|string} id - Headphones ID
     * @returns {string}
     */
    getThumbnailUrl(id) {
        return `${this.baseUrl}/api/headphones/${encodeURIComponent(id)}/thumbnail`;
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
