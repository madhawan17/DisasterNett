import { create } from "zustand";
import { insightsApi } from "../api/insightsApi.js";

export const useLifelineStore = create((set) => ({
  isLoading: false,
  error: null,
  data: null,

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),

  setLifelineData: (apiData) => {
    set({
      data: apiData,
      isLoading: false,
      error: null,
    });
  },
  fetchLifelineData: async (payload) => {
    set({ isLoading: true, error: null });
    const { data, error } = await insightsApi.analyzeLifeline(payload);
    if (error) {
      set({ error, isLoading: false });
      return;
    }
    set({
      data,
      isLoading: false,
      error: null,
    });
  },

  clearLifelineData: () => {
    set({
      data: null,
      error: null,
      isLoading: false,
    });
  },
}));
