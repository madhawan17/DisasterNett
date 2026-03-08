import { create } from "zustand";

export const useAppStore = create((set, get) => ({
  activeTab: "landing", // login | signup | landing | mission | globe
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Global notification
  notification: null,
  showNotification: (msg, type = "info") => {
    set({ notification: { msg, type, id: Date.now() } });
    setTimeout(() => set({ notification: null }), 4000);
  },

  // Stats counters (tick up on load)
  statsReady: false,
  setStatsReady: () => set({ statsReady: true }),

  // Global Auth Sync State
  token: localStorage.getItem("hackx_auth_token") || null,
  user: (() => {
    try {
      const storedUser = localStorage.getItem("hackx_user");
      return storedUser ? JSON.parse(storedUser) : null;
    } catch {
      localStorage.removeItem("hackx_user");
      return null;
    }
  })(),
  setAuthData: (token, user) => set({ token, user }),
  clearAuthData: () => set({ token: null, user: null }),
}));
