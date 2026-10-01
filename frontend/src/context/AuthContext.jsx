import { createContext, useContext, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../utils/api';
import { getToken, setToken, clearToken } from '../utils/token';
import { clearIdleTracking } from '../hooks/useIdleLogout';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  // Every cached query belongs to the user who was signed in when it was
  // fetched. Without wiping the cache on each identity change, the next user
  // is served the previous user's projects, users and settings straight from
  // memory — a full page refresh was the only thing that cleared it.
  const resetCache = () => queryClient.clear();

  useEffect(() => {
    let cancelled = false;
    const done = () => { if (!cancelled) setLoading(false); };

    if (getToken()) {
      // An expired access token is handled by the interceptor, which refreshes
      // and retries this call, so a stale token still resolves to a session.
      api.get('/auth/me')
        .then(r => { if (!cancelled) setUser(r.data); })
        .catch(() => clearToken())
        .finally(done);
      return () => { cancelled = true; };
    }

    // No access token in this tab. The refresh cookie is scoped to the browser
    // rather than the tab, so a second tab of a live session lands here - ask
    // the server before deciding the user is signed out. A genuinely signed-out
    // visitor gets a 401 and falls through to /login as before.
    clearToken();
    api.post('/auth/refresh', {}, { withCredentials: true })
      .then(r => {
        if (cancelled) return;
        setToken(r.data.token);
        setUser(r.data.user);
      })
      .catch(() => clearToken())
      .finally(done);

    return () => { cancelled = true; };
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    resetCache();
    clearIdleTracking();
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  // Signup and login both receive the user with their token, so there is no
  // reason to fetch it again. Exposed rather than duplicating the cache reset
  // and idle-tracking reset at each call site.
  const adoptSession = nextUser => {
    resetCache();
    clearIdleTracking();
    setUser(nextUser);
  };

  const logout = () => {
    // Ends the session server-side too, so the refresh cookie cannot be used
    // to mint new access tokens after signing out. Fire-and-forget: the local
    // state must clear even if the request fails, and the cookie is scoped to
    // /api/auth so the browser attaches it without help from here.
    api.post('/auth/logout', {}, { withCredentials: true }).catch(() => {});
    clearIdleTracking();
    clearToken();
    setUser(null);
    resetCache();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, adoptSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
