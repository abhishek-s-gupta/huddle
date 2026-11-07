/**
 * Unified API Client for Huddle
 * Handles automatic CSRF tokens, credentials, and error responses.
 */

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

export async function request(url, options = {}) {
  const headers = options.headers || {};

  // For non-safe methods, ensure CSRF token is attached
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCookie('csrf_token');
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin'
  });

  // Handle redirects or JSON payloads
  const contentType = response.headers.get('content-type');
  let data = null;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  }

  if (!response.ok) {
    const errorMsg = data?.error || `Request failed with status ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  get: (url) => request(url, { method: 'GET' }),
  post: (url, body) => request(url, { method: 'POST', body }),
  put: (url, body) => request(url, { method: 'PUT', body }),
  delete: (url, body) => request(url, { method: 'DELETE', body }),

  // Auth conveniences
  signup: (email, password, displayName) => request('/api/auth/signup', {
    method: 'POST',
    body: { email, password, displayName }
  }),
  login: (email, password) => request('/api/auth/login', {
    method: 'POST',
    body: { email, password }
  }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  getMe: () => request('/api/auth/me', { method: 'GET' })
};
