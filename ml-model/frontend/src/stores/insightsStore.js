import { create } from "zustand";
import { insightsApi } from "../api/insightsApi.js";

export const useInsightsStore = create((set, get) => ({
  // ── Runs list (GET /runs) ──────────────────────────────────
  runs: [],
  runsLoading: false,
  runsError: null,

  fetchRuns: async () => {
    if (get().runsLoading || get().runs.length > 0) return;
    set({ runsLoading: true, runsError: null });
    const { data, error } = await insightsApi.getRuns();
    if (error) {
      set({ runsLoading: false, runsError: error });
      return;
    }
    set({ runs: data.runs ?? [], runsLoading: false });
  },

  // ── Selected run detail (GET /runs/:id) ───────────────────
  selectedRunId: null,
  selectedRun: null,
  detailLoading: false,
  detailError: null,

  selectRun: async (runId) => {
    // If same run already loaded, just surface it
    if (get().selectedRunId === runId && get().selectedRun) return;

    set({
      selectedRunId: runId,
      detailLoading: true,
      detailError: null,
      selectedRun: null,
    });
    const { data, error } = await insightsApi.getRunDetail(runId);
    if (error) {
      set({ detailLoading: false, detailError: error });
      return;
    }
    set({ selectedRun: data, detailLoading: false });
  },

  clearSelection: () =>
    set({
      selectedRunId: null,
      selectedRun: null,
      detailError: null,
    }),
}));
