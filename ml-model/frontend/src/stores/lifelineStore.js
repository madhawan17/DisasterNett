import { create } from "zustand";

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

  clearLifelineData: () => {
    set({
      data: null,
      error: null,
      isLoading: false,
    });
  },
}));
