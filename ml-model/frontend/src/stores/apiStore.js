import { create } from 'zustand'
import { ENDPOINTS } from '../data/endpoints.js'

const RUN_STATES = ['queued','preprocessing','detecting','scoring','completed']

export const useApiStore = create((set, get) => ({
  activeEndpoint: ENDPOINTS[0].id,
  setActiveEndpoint: (id) => set({ activeEndpoint: id }),

  activeTab: 'curl',   // curl | python | response
  setActiveTab: (t) => set({ activeTab: t }),

  // Live tester state
  testerRunning: false,
  testerOutput: '',
  testerStep: -1,
  testerFailed: false,

  runTester: (endpointId) => {
    const store = get()
    if (store.testerRunning) return

    const ep = ENDPOINTS.find(e => e.id === endpointId)
    if (!ep) return

    set({ testerRunning: true, testerOutput: '', testerStep: 0, testerFailed: false })

    if (ep.id === 'submit') {
      // Simulate lifecycle
      let step = 0
      const printLine = (line) => {
        set(s => ({ testerOutput: s.testerOutput + line + '\n' }))
      }

      const initialJson = JSON.stringify({ run_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', status: 'queued', eta_minutes: 35 }, null, 2)
      printLine('> POST /api/v1/runs  HTTP 202 Accepted')
      printLine(initialJson)
      printLine('')

      const poll = setInterval(() => {
        step++
        set({ testerStep: step })
        if (step < RUN_STATES.length) {
          printLine(`> GET /runs/3fa85f64  → status: "${RUN_STATES[step]}"`)
        } else {
          clearInterval(poll)
          const finalJson = JSON.stringify(ep.response, null, 2)
          printLine('')
          printLine('> Final result:')
          printLine(finalJson)
          set({ testerRunning: false })
        }
      }, 900)
    } else {
      // Simple response
      const json = JSON.stringify(ep.response, null, 2)
      let output = `> ${ep.method} ${ep.path}\n`
      output += `< HTTP ${ep.statusCode} ${ep.statusText}\n\n`
      let buf = ''
      let charIdx = 0
      const charTimer = setInterval(() => {
        if (charIdx < json.length) {
          buf += json[charIdx]
          set({ testerOutput: output + buf })
          charIdx++
        } else {
          clearInterval(charTimer)
          set({ testerRunning: false })
        }
      }, 6)
    }
  },

  clearTester: () => set({ testerOutput: '', testerStep: -1, testerRunning: false, testerFailed: false }),
}))
