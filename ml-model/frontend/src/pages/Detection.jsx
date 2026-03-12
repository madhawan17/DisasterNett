import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Satellite, 
  Map as MapIcon, 
  Calendar, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2,
  Maximize2,
  Crosshair,
  Layers
} from "lucide-react";
import PageHeader from "../components/common/PageHeader.jsx";

export default function Detection() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState("");

  const handleRunAnalysis = () => {
    if (!selectedRegion) return;
    setIsAnalyzing(true);
    setShowResults(false);
    
    // Mock network request delay
    setTimeout(() => {
      setIsAnalyzing(false);
      setShowResults(true);
    }, 4500);
  };

  return (
    <div className="flex flex-col min-h-screen pt-14 bg-gray-50 font-sans selection:bg-green-100 selection:text-green-900">
      
      <PageHeader 
        title="SAR Detection Processing"
        subtitle="Real-time Synthetic Aperture Radar anomaly detection."
        icon={Satellite}
      />

      <div className="flex-1 max-w-7xl mx-auto w-full p-6 grid lg:grid-cols-12 gap-6 h-full">
        
        {/* ── Left Sidebar: Controls ── */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex-shrink-0">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 mb-2">SAR Target Acquisition</h1>
            <p className="text-sm text-gray-500 mb-6">Initialize a real-time Synthetic Aperture Radar scan to detect anomalous water bodies.</p>
            
            <div className="space-y-5">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">1. Target Region</label>
                <div className="relative">
                  <MapIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <select 
                    value={selectedRegion}
                    onChange={(e) => setSelectedRegion(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/50 appearance-none"
                  >
                    <option value="" disabled>Select a coordinate grid...</option>
                    <option value="larkana">Sector 4A - Larkana District</option>
                    <option value="south-valley">Sector 2V - South Valley</option>
                    <option value="coastal">Sector 9C - Coastal Highway</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">2. Temporal Window</label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="date" 
                    defaultValue="2026-03-12"
                    className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">3. Sensor Array</label>
                <div className="grid grid-cols-2 gap-2">
                  <button className="py-2 px-3 border-2 border-green-500 bg-green-50 text-green-700 rounded-xl text-xs font-bold">Sentinel-1 (SAR)</button>
                  <button className="py-2 px-3 border border-gray-200 bg-gray-50 text-gray-500 rounded-xl text-xs font-medium hover:border-gray-300">Sentinel-2 (Optical)</button>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <button 
                  onClick={handleRunAnalysis}
                  disabled={!selectedRegion || isAnalyzing}
                  className={`w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                    !selectedRegion ? 'bg-gray-100 text-gray-400 cursor-not-allowed' :
                    isAnalyzing ? 'bg-green-600 text-white shadow-lg shadow-green-500/20' : 
                    'bg-green-500 hover:bg-green-600 text-white shadow-lg shadow-green-500/20'
                  }`}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Acquiring Telemetry...
                    </>
                  ) : (
                    <>
                      <Satellite className="w-5 h-5" />
                      Initialize Scan
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Active Sensors Status Box */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex-1">
             <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex justify-between items-center">
               Live Orbital Status
               <span className="relative flex h-2 w-2">
                 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                 <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
               </span>
             </h3>
             <ul className="space-y-4">
               {[
                 { name: "Sentinel-1A", ping: "14ms", status: "Optimal" },
                 { name: "Sentinel-1B", ping: "22ms", status: "Optimal" },
                 { name: "Landsat 9", ping: "45ms", status: "Degraded (Cloud Cover)" }
               ].map((sat, i) => (
                 <li key={i} className="flex justify-between items-center">
                   <div className="flex items-center gap-2">
                     <Satellite className="w-4 h-4 text-gray-400" />
                     <span className="text-sm font-medium text-gray-700">{sat.name}</span>
                   </div>
                   <div className="flex items-center gap-3">
                     <span className="text-xs font-bold text-gray-400">{sat.ping}</span>
                     <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${sat.status === 'Optimal' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
                       {sat.status.split(' ')[0]}
                     </span>
                   </div>
                 </li>
               ))}
             </ul>
          </div>

        </div>

        {/* ── Right Side: Image Viewport ── */}
        <div className="lg:col-span-8 flex flex-col h-full bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden relative">
          
          <div className="h-14 border-b border-gray-100 flex items-center justify-between px-6 bg-gray-50/50">
            <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-green-500" /> Primary Viewport
            </span>
            <div className="flex gap-2">
               <button className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"><Layers className="w-4 h-4" /></button>
               <button className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"><Maximize2 className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="flex-1 bg-gray-900 relative overflow-hidden flex items-center justify-center">
            
            {/* Empty State */}
            {!isAnalyzing && !showResults && (
               <div className="text-center">
                 <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-4 border border-gray-700">
                   <Satellite className="w-6 h-6 text-gray-500" />
                 </div>
                 <p className="text-gray-400 font-medium">Awaiting target coordinates.</p>
               </div>
            )}

            {/* Scanning Overlay */}
            <AnimatePresence>
              {isAnalyzing && (
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(#333_1px,transparent_1px)] [background-size:24px_24px] opacity-20"></div>
                  
                  {/* Radar Sweep Line */}
                  <motion.div 
                    animate={{ top: ["0%", "100%", "0%"] }}
                    transition={{ duration: 3, ease: "linear", repeat: Infinity }}
                    className="absolute inset-x-0 h-32 bg-gradient-to-b from-transparent via-green-500/20 to-green-500/80 border-b border-green-500 z-20"
                  />
                  
                  <div className="absolute inset-0 flex items-center justify-center z-30">
                    <div className="bg-gray-900/80 backdrop-blur border border-gray-700 p-4 rounded-xl flex items-center gap-3">
                      <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
                      <span className="text-sm font-bold text-white tracking-widest uppercase">Processing VV/VH Bands...</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Simulated Result Image */}
            <AnimatePresence>
              {showResults && (
                <motion.div
                  initial={{ opacity: 0, scale: 1.05 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.8 }}
                  className="absolute inset-0 w-full h-full"
                >
                   {/* We'll use a placeholder structure mimicking a SAR scan for now */}
                   <div className="w-full h-full bg-slate-800 relative bg-[url('https://images.unsplash.com/photo-1582293040182-1596796b42b6?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center grayscale filter contrast-125">
                     <div className="absolute inset-0 bg-blue-500/20 mix-blend-overlay"></div>
                     
                     {/* Bounding Boxes representing flooded areas */}
                     <motion.div 
                       initial={{ opacity: 0, scale: 0.8 }}
                       animate={{ opacity: 1, scale: 1 }}
                       transition={{ delay: 1 }}
                       className="absolute top-[30%] left-[40%] w-64 h-32 border-2 border-red-500 bg-red-500/20"
                     >
                        <div className="absolute -top-6 left-0 bg-red-500 text-white text-[10px] font-bold px-2 py-1 uppercase tracking-wider">
                          Critical Flood Extent (8.4 km²)
                        </div>
                     </motion.div>

                     <motion.div 
                       initial={{ opacity: 0, scale: 0.8 }}
                       animate={{ opacity: 1, scale: 1 }}
                       transition={{ delay: 1.2 }}
                       className="absolute top-[60%] left-[20%] w-48 h-48 border-2 border-yellow-500 bg-yellow-500/20"
                     >
                        <div className="absolute -top-6 left-0 bg-yellow-500 text-gray-900 text-[10px] font-bold px-2 py-1 uppercase tracking-wider">
                          Moderate Warning (4.1 km²)
                        </div>
                     </motion.div>
                     
                   </div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>

          {/* Results Footer Panel */}
          <div className="h-20 border-t border-gray-100 bg-white flex items-center px-6 gap-8">
            {showResults ? (
               <>
                 <div>
                   <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Status</span>
                   <span className="text-sm font-bold text-green-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Scan Complete</span>
                 </div>
                 <div className="w-px h-8 bg-gray-200"></div>
                 <div>
                   <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Confidence</span>
                   <span className="text-sm font-bold text-gray-900">92.4% (Threshold: High)</span>
                 </div>
                 <div className="w-px h-8 bg-gray-200"></div>
                 <div>
                   <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Total Impact Area</span>
                   <span className="text-sm font-black text-red-500">12.5 km²</span>
                 </div>
                 <div className="ml-auto">
                    <button className="bg-green-50 text-green-600 hover:bg-green-100 px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                      Export Report
                    </button>
                 </div>
               </>
            ) : (
               <span className="text-sm font-medium text-gray-400 italic">No telemetry data loaded.</span>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
