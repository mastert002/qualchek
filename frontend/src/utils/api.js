import axios from 'axios';
import { getToken, setToken, clearToken } from './token';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use(config => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Access tokens last 15 minutes, so an ordinary working session will hit an
// expired one repeatedly. The refresh token lives in an httpOnly cookie the
// browser attaches by itself - there is nothing to read or send from here,
// which is the point: script cannot reach the durable half of the session.
//
// withCredentials is required even though this is same-origin, because axios
// omits credentials by default.
const refreshSession = () =>
  axios.post('/api/auth/refresh', {}, { withCredentials: true }).then(r => r.data.token);

// One refresh at a time. A page that fires six queries on mount would
// otherwise send six refreshes; five of them would present a token the first
// had already rotated away, which reads as replay and revokes the family -
// signing the user out for doing nothing wrong.
let inFlight = null;
function refreshOnce() {
  if (!inFlight) {
    inFlight = refreshSession().finally(() => { inFlight = null; });
  }
  return inFlight;
}

const bounceToLogin = () => {
  clearToken();
  window.location.href = '/login';
};

api.interceptors.response.use(
  r => r,
  async err => {
    const original = err.config || {};
    const url = original.url || '';

    // A 401 from an authentication attempt is an expected outcome, not an
    // expired session: the caller renders "Invalid credentials". Redirecting
    // reloads the page and wipes that message before it can be read.
    const isAuthAttempt = /\/auth\/(login|invite|refresh|logout)/.test(url);
    const alreadyOnLogin = window.location.pathname === '/login';

    if (err.response?.status !== 401 || isAuthAttempt || alreadyOnLogin) {
      return Promise.reject(err);
    }

    // Retry once. Without the flag a request that 401s again after a
    // successful refresh would loop.
    if (original._retried) {
      bounceToLogin();
      return Promise.reject(err);
    }
    original._retried = true;

    try {
      const token = await refreshOnce();
      setToken(token);
      original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
      return api(original);
    } catch {
      // No usable session: the cookie is missing, expired, or was revoked.
      bounceToLogin();
      return Promise.reject(err);
    }
  }
);

export default api;
