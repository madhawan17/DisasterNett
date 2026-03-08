import { useState, useCallback, useEffect } from "react";
import { useAppStore } from "../stores/appStore.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === "true";
const TOKEN_KEY = "hackx_auth_token";
const USER_KEY = "hackx_user";

/* ── Mock helpers (used when VITE_MOCK_MODE=true) ───────────────────────── */
const MOCK_TOKEN = "mock.eyJtb2NrIjp0cnVlfQ.signature";
const createMockUser = (email) => ({
  id: "mock_user_" + Date.now(),
  email,
  subscription_level: "free",
  auth_provider: "local",
  created_at: new Date().toISOString(),
});

/**
 * Hook for authentication state and operations
 * Manages JWT tokens and user info in localStorage
 */
export function useAuth() {
  const token = useAppStore((s) => s.token);
  const user = useAppStore((s) => s.user);
  const setAppAuthData = useAppStore((s) => s.setAuthData);
  const clearAppAuthData = useAppStore((s) => s.clearAuthData);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Store authentication data in localStorage
   */
  const storeAuthData = useCallback(
    (newToken, newUser) => {
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, JSON.stringify(newUser));
      setAppAuthData(newToken, newUser);
    },
    [setAppAuthData],
  );

  /**
   * Clear authentication data
   */
  const clearAuthData = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    clearAppAuthData();
  }, [clearAppAuthData]);

  /**
   * Get the current authorization header
   */
  const getAuthHeader = useCallback(() => {
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }, [token]);

  /**
   * Signup with email and password
   */
  const signup = useCallback(
    async (email, password) => {
      setIsLoading(true);
      setError(null);

      try {
        if (MOCK_MODE) {
          // Simulate a short network delay
          await new Promise((r) => setTimeout(r, 400));
          const mockUser = createMockUser(email);
          storeAuthData(MOCK_TOKEN, mockUser);
          return { token: MOCK_TOKEN, user: mockUser };
        }

        const response = await fetch(`${API_URL}/auth/signup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.detail || errorData.error || "Signup failed",
          );
        }

        const data = await response.json();
        storeAuthData(data.token, data.user);
        return data;
      } catch (err) {
        const message = err.message || "An error occurred during signup";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [storeAuthData],
  );

  /**
   * Login with email and password
   */
  const login = useCallback(
    async (email, password) => {
      setIsLoading(true);
      setError(null);

      try {
        if (MOCK_MODE) {
          await new Promise((r) => setTimeout(r, 400));
          const mockUser = createMockUser(email);
          storeAuthData(MOCK_TOKEN, mockUser);
          return { token: MOCK_TOKEN, user: mockUser };
        }

        const response = await fetch(`${API_URL}/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.detail || errorData.error || "Login failed",
          );
        }

        const data = await response.json();
        storeAuthData(data.token, data.user);
        return data;
      } catch (err) {
        const message = err.message || "An error occurred during login";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [storeAuthData],
  );

  /**
   * Logout and invalidate token
   */
  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (!MOCK_MODE && token) {
        await fetch(`${API_URL}/auth/logout`, {
          method: "POST",
          headers: {
            ...getAuthHeader(),
            "Content-Type": "application/json",
          },
        });
      }
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      clearAuthData();
      setIsLoading(false);
      window.location.href = "/";
    }
  }, [token, getAuthHeader, clearAuthData]);

  /**
   * Get current user info
   */
  const getCurrentUser = useCallback(async () => {
    if (!token) {
      return null;
    }

    if (MOCK_MODE) {
      return user;
    }

    let response;
    try {
      response = await fetch(`${API_URL}/auth/me`, {
        method: "GET",
        headers: getAuthHeader(),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch user info");
      }

      const data = await response.json();
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return data.user;
    } catch (err) {
      console.error("Get user error:", err);
      if (response?.status === 401) {
        clearAuthData();
      }
      return null;
    }
  }, [token, user, getAuthHeader, clearAuthData]);

  /**
   * Refresh authentication token
   */
  const refreshToken = useCallback(async () => {
    if (!token) {
      return null;
    }

    if (MOCK_MODE) {
      return { token: MOCK_TOKEN, user };
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/auth/refresh-token`, {
        method: "POST",
        headers: getAuthHeader(),
      });

      if (!response.ok) {
        throw new Error("Token refresh failed");
      }

      const data = await response.json();
      storeAuthData(data.token, data.user);
      return data;
    } catch (err) {
      console.error("Token refresh error:", err);
      clearAuthData();
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [token, user, getAuthHeader, storeAuthData, clearAuthData]);

  /**
   * Initiate Google OAuth login
   */
  const loginWithGoogle = useCallback(() => {
    if (MOCK_MODE) {
      const mockUser = createMockUser("mockuser@google.com");
      storeAuthData(MOCK_TOKEN, mockUser);
      return;
    }
    // Redirect to backend's Google OAuth endpoint
    window.location.href = `${API_URL}/auth/google`;
  }, [storeAuthData]);

  /**
   * Handle OAuth callback with token in URL
   */
  const handleOAuthCallback = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token");

    if (tokenFromUrl) {
      // Decode token to get user info (basic decoding without verification)
      try {
        const parts = tokenFromUrl.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          const userInfo = {
            id: payload.user_id,
            email: payload.email,
            subscription_level: payload.subscription_level,
            auth_provider: payload.auth_provider,
          };
          storeAuthData(tokenFromUrl, userInfo);

          // Clean up URL
          window.history.replaceState({}, document.title, "/");

          return { token: tokenFromUrl, user: userInfo };
        }
      } catch (e) {
        console.error("Failed to decode OAuth token:", e);
      }
    }

    return null;
  }, [storeAuthData]);

  return {
    // State
    user,
    token,
    isLoading,
    error,
    isAuthenticated: !!token,

    // Methods
    login,
    signup,
    logout,
    getCurrentUser,
    refreshToken,
    loginWithGoogle,
    handleOAuthCallback,
    getAuthHeader,
    storeAuthData,
    clearAuthData,
  };
}
