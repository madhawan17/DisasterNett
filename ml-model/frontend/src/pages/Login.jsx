import React, { useState, useEffect, lazy, Suspense } from "react";
import { motion } from "framer-motion";
import { useAppStore } from "../stores/appStore.js";
import { useAuth } from "../hooks/useAuth.js";

// Lazy-load the Spline component so its heavy JS bundle (~2MB) is deferred
// and doesn't block the first paint of the login form.
const Spline = lazy(() => import("@splinetool/react-spline"));

export default function Login() {
  const { setActiveTab, showNotification } = useAppStore();
  const { login, loginWithGoogle } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [splineLoaded, setSplineLoaded] = useState(false);

  // Aggressive Spline watermark removal hook
  useEffect(() => {
    const removeWatermark = () => {
      document.querySelectorAll("spline-viewer").forEach((viewer) => {
        const logo = viewer.shadowRoot?.querySelector("#logo");
        if (logo) logo.remove();
      });
      document
        .querySelectorAll('a[href*="spline.design"], a[href*="splinetool"]')
        .forEach((a) => {
          a.remove();
        });
    };
    removeWatermark();
    const int1 = setInterval(removeWatermark, 100);
    const int2 = setTimeout(() => clearInterval(int1), 5000);
    return () => clearInterval(int1);
  }, []);

  const handleSignIn = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      showNotification("Please enter email and password", "warning");
      return;
    }

    setIsLoading(true);
    try {
      await login(email, password);
      showNotification(`Welcome back, ${email.split("@")[0]}`, "success");
      setTimeout(() => setActiveTab("landing"), 300);
    } catch (error) {
      showNotification(
        error.message || "Login failed. Please try again.",
        "error",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    try {
      loginWithGoogle();
    } catch (error) {
      showNotification("Failed to initiate Google Sign-In", "error");
    }
  };

  return (
    <div className="flex w-full h-screen bg-[#020617] overflow-hidden font-sans relative">
      {/* ── Top-Left Brand Overview ── */}
      <div className="absolute top-20 left-20 sm:left-12 xl:left-20 z-50 pointer-events-none">
        <div className="font-display font-bold text-3xl tracking-[0.2em] text-white leading-none uppercase">
          Ambrosia
        </div>
      </div>

      {/* ── Left Side: Spline Art & Branding (60%) ── */}
      <div className="relative flex-1 hidden lg:block overflow-hidden pointer-events-auto">
        {/* Large Spline Canvas (Cropped to hide watermark) */}
        <div
          className="absolute top-0 left-0 w-full h-[calc(100vh+80px)]"
          style={{
            opacity: splineLoaded ? 1 : 0,
            transform: splineLoaded ? "translateY(0)" : "translateY(20px)",
            transition:
              splineLoaded ?
                "opacity 500ms cubic-bezier(0.25,0.46,0.45,0.94), transform 500ms cubic-bezier(0.25,0.46,0.45,0.94)"
              : "none",
          }}
        >
          <Suspense fallback={<div className="w-full h-full bg-[#020617]" />}>
            <Spline
              scene="https://prod.spline.design/OnP8WcwVxeq8dv0g/scene.splinecode"
              onLoad={() => setSplineLoaded(true)}
            />
          </Suspense>
        </div>

        {/* Subtle vignette so the art blends smoothly */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#020617_120%)] opacity-80 pointer-events-none" />

        {/* Left-Aligned Value Proposition overlaid on the art */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="absolute bottom-16 left-12 xl:left-20 pointer-events-none"
        >
          <h2 className="text-white font-bold text-3xl xl:text-4xl tracking-wide mb-2 max-w-lg leading-tight">
            Real-Time Climate Risk Intelligence.
          </h2>
          <p className="text-white/60 text-lg max-w-md">
            Powered by next-generation satellite data and neural analytics.
          </p>
        </motion.div>
      </div>

      {/* ── Right Side: Glass Login Column (40%) ── */}
      <div className="relative w-full lg:w-[460px] xl:w-[500px] h-full bg-[#020617]/40 sm:bg-black/60 backdrop-blur-3xl border-l border-white/10 flex flex-col justify-center px-10 sm:px-14 z-10 shrink-0">
        {/* Subtle ambient lighting inside the login column */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-[360px] mx-auto"
        >
          <div className="mb-10">
            <h1 className="text-3xl font-bold text-white mb-2 tracking-wide">
              Sign In
            </h1>
            <p className="text-white/40 text-[13px] font-medium">
              Enter your email and password to access the platform.
            </p>
          </div>

          <form onSubmit={handleSignIn} className="w-full flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-widest font-semibold px-1 text-white/50">
                Email
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full bg-black/40 border border-white/10 text-white rounded-xl px-4 py-3.5 text-sm outline-none transition-all placeholder:text-white/20 focus:bg-black/60 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 shadow-inner"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-widest font-semibold px-1 text-white/50">
                Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="w-full bg-black/40 border border-white/10 text-white rounded-xl px-4 py-3.5 text-sm outline-none transition-all placeholder:text-white/20 focus:bg-black/60 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 shadow-inner"
                />
              </div>
            </div>

            <button
              id="login-form-submit"
              disabled={isLoading}
              type="submit"
              className="group relative w-full mt-4 bg-white/10 text-white font-medium rounded-xl py-3.5 text-sm hover:bg-white/20 transition-all flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/20 to-teal-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              <span className="relative z-10 flex items-center gap-2">
                {isLoading ?
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                : "Sign In"}
              </span>
            </button>

            <div className="relative flex items-center my-4">
              <div className="flex-grow border-t border-white/10" />
              <span className="flex-shrink mx-4 text-white/40 text-xs uppercase tracking-widest">
                Or
              </span>
              <div className="flex-grow border-t border-white/10" />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="group relative w-full bg-white/10 text-white font-medium rounded-xl py-3.5 text-sm hover:bg-white/20 transition-all flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/20 to-teal-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              <span className="relative z-10 flex items-center gap-2">
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google
              </span>
            </button>
            <div className="mt-4 text-center">
              <span className="text-white/40 text-[13px] font-medium">
                Don't have an account?{" "}
              </span>
              <button
                type="button"
                onClick={() => setActiveTab("signup")}
                className="text-white/70 text-[13px] font-medium hover:text-white transition-colors"
              >
                Sign Up
              </button>
            </div>
          </form>
        </motion.div>
      </div>

      {/* Mobile background — pure CSS gradient (replaces second Spline instance) */}
      <div className="absolute inset-0 lg:hidden pointer-events-none -z-10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 30% 40%, rgba(56,189,248,0.12) 0%, transparent 60%), " +
              "radial-gradient(ellipse at 70% 70%, rgba(20,184,166,0.10) 0%, transparent 55%), " +
              "#020617",
          }}
        />
      </div>
    </div>
  );
}
