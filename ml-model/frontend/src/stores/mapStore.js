import { create } from 'zustand'
import { DISTRICTS } from '../data/districts.js'

export const useMapStore = create((set, get) => ({
  selectedDistrict: null,
  setSelectedDistrict: (d) => set({ selectedDistrict: d }),
  clearSelected: () => set({ selectedDistrict: null }),

  overlay: 'risk',       // 'risk' | 'flood' | 'population'
  setOverlay: (o) => set({ overlay: o }),

  filterRisk: 'all',     // 'all' | 'Critical' | 'High' | 'Medium' | 'Low' | 'None'
  setFilterRisk: (r) => set({ filterRisk: r }),

  hoveredDistrict: null,
  setHoveredDistrict: (d) => set({ hoveredDistrict: d }),

  visibleDistricts: () => {
    const { filterRisk } = get()
    if (filterRisk === 'all') return DISTRICTS
    return DISTRICTS.filter(d => d.risk === filterRisk)
  },

  totalFlooded: DISTRICTS.reduce((s, d) => s + d.floodPct * d.area / 100, 0).toFixed(0),
  totalExposed: DISTRICTS.reduce((s, d) => s + d.pop * d.floodPct / 100, 0),
}))
