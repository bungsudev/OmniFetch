/**
 * API Client - Helper for admin panel API calls
 */

const API_BASE = window.location.origin + '/api';

const api = {
  /**
   * Get stored JWT token
   */
  getToken() {
    return localStorage.getItem('htp_token');
  },

  /**
   * Set JWT token
   */
  setToken(token) {
    localStorage.setItem('htp_token', token);
  },

  /**
   * Clear auth
   */
  clearAuth() {
    localStorage.removeItem('htp_token');
    localStorage.removeItem('htp_user');
  },

  /**
   * Get stored user info
   */
  getUser() {
    try {
      return JSON.parse(localStorage.getItem('htp_user'));
    } catch {
      return null;
    }
  },

  /**
   * Set user info
   */
  setUser(user) {
    localStorage.setItem('htp_user', JSON.stringify(user));
  },

  /**
   * Check if authenticated
   */
  isAuthenticated() {
    return !!this.getToken();
  },

  /**
   * Make API request
   */
  async request(method, endpoint, data = null) {
    const url = `${API_BASE}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const token = this.getToken();
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    if (data && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, options);

      if (response.status === 401) {
        this.clearAuth();
        window.location.href = '/login.html';
        throw new Error('Unauthorized');
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      return result;
    } catch (err) {
      if (err.message === 'Unauthorized') throw err;
      console.error(`[API] ${method} ${endpoint} failed:`, err);
      throw err;
    }
  },

  // Convenience methods
  get(endpoint) { return this.request('GET', endpoint); },
  post(endpoint, data) { return this.request('POST', endpoint, data); },
  put(endpoint, data) { return this.request('PUT', endpoint, data); },
  delete(endpoint) { return this.request('DELETE', endpoint); },

  /**
   * Login
   */
  async login(email, password) {
    const result = await this.post('/auth/login', { email, password });
    this.setToken(result.token);
    this.setUser(result.user);
    return result;
  },

  /**
   * Verify token
   */
  async verifyToken() {
    try {
      const result = await this.get('/auth/me');
      return result.user;
    } catch {
      this.clearAuth();
      return null;
    }
  },
};
