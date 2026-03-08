import { create } from 'zustand'

export const useRiskStore = create((set) => ({
  districtSummaries: [],   // array from response.district_summaries
  globalMetrics: null,     // response.enhanced_risk_modeling
  isLoading: false,
  error: null,

  setRiskData: (data) => set({
    districtSummaries: data?.district_summaries ?? [],
    globalMetrics: data?.enhanced_risk_modeling ?? null,
    error: null,
  }),
  clearRiskData: () => set({
    districtSummaries: [],
    globalMetrics: null,
    error: null,
  }),
  setLoading: (bool) => set({ isLoading: bool }),
  setError: (err) => set({ error: err, isLoading: false }),
}))
