/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#07090e",
        "bg-2": "#0c1018",
        "bg-3": "#111820",
        "bg-card": "#0e141f",
        gold: "#d4900a",
        "gold-lt": "#e8ab30",
        ice: "#4ab0d8",
        critical: "#d84040",
        high: "#d06828",
        medium: "#c8a018",
        low: "#38a058",
        "no-risk": "#2a3f58",
        text: "#bfcfd8",
        "text-2": "rgba(170,190,205,0.55)",
        "text-3": "rgba(140,165,180,0.3)",
      },
      fontFamily: {
        display: ["Playfair Display", "Times New Roman", "serif"],
        body: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Courier New", "Courier", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "spin-slow": "spin 8s linear infinite",
        drift: "drift 20s linear infinite",
        float: "float 6s ease-in-out infinite",
        scan: "scan 4s ease-in-out infinite",
        "glow-pulse": "glowPulse 2s ease-in-out infinite",
        typewriter: "typewriter 0.05s steps(1) forwards",
        "fade-up": "fadeUp 0.6s ease-out forwards",
        "slide-in": "slideIn 0.4s ease-out forwards",
      },
      keyframes: {
        drift: {
          "0%": { transform: "translateX(-100px) translateY(0)" },
          "100%": {
            transform: "translateX(calc(100vw + 100px)) translateY(-40px)",
          },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" },
        },
        scan: {
          "0%, 100%": { opacity: "0.3", transform: "scaleX(0.8)" },
          "50%": { opacity: "1", transform: "scaleX(1)" },
        },
        glowPulse: {
          "0%, 100%": { boxShadow: "0 0 8px rgba(212,144,10,0.3)" },
          "50%": {
            boxShadow:
              "0 0 24px rgba(212,144,10,0.8), 0 0 48px rgba(212,144,10,0.3)",
          },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          "0%": { opacity: "0", transform: "translateX(-20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      boxShadow: {
        "gold-sm": "0 0 8px rgba(212,144,10,0.3)",
        "gold-md": "0 0 20px rgba(212,144,10,0.5)",
        "gold-lg": "0 0 40px rgba(212,144,10,0.4)",
        "ice-sm": "0 0 8px rgba(74,176,216,0.3)",
        "ice-md": "0 0 20px rgba(74,176,216,0.5)",
        "critical-glow": "0 0 16px rgba(216,64,64,0.6)",
        card: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
