import { create } from 'zustand'
import { insightsApi } from '../api/insightsApi.js'

export const useRiskStore = create((set) => ({
  districtSummaries: [],   // array from response.district_summaries
  globalMetrics: null,     // response.enhanced_risk_modeling
  isLoading: false,
  error: null,
  lastRequestKey: null,

  setRiskData: (data) => set({
    districtSummaries: data?.district_summaries ?? [],
    globalMetrics: data?.enhanced_risk_modeling ?? null,
    error: null,
  }),
  fetchRiskAnalysis: async (payload) => {
    const requestKey = JSON.stringify(payload ?? {})
    set({ isLoading: true, error: null, lastRequestKey: requestKey })

    const { data, error } = await insightsApi.analyzeRisk(payload)
    if (error) {
      set({ error, isLoading: false })
      return
    }

    set({
      districtSummaries: data?.district_summaries ?? [],
      globalMetrics: data?.enhanced_risk_modeling ?? null,
      isLoading: false,
      error: null,
      lastRequestKey: requestKey,
    })
  },
  clearRiskData: () => set({
    districtSummaries: [],
    globalMetrics: null,
    error: null,
    lastRequestKey: null,
  }),
  setLoading: (bool) => set({ isLoading: bool }),
  setError: (err) => set({ error: err, isLoading: false }),
}))
