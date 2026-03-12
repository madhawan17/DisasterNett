import React, { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Satellite, 
  Map as MapIcon, 
  Calendar, 
  CheckCircle2, 
  Loader2,
  Maximize2,
  Crosshair,
  Layers,
  AlertTriangle
} from "lucide-react";
import PageHeader from "../components/common/PageHeader.jsx";
import GeoSearchInput from "../components/ui/GeoSearchInput.jsx";
import { geocodeApi, parseNominatimResult, hasAreaGeometry, sortResultsByBoundary } from "../api/geocodeApi.js";
import { insightsApi } from "../api/insightsApi.js";

export default function Detection() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  
  // Geosearch State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedGeocoded, setSelectedGeocoded] = useState(null);
  const [analysisDate, setAnalysisDate] = useState(() => new Date().toISOString().slice(0, 10));
  const debounceRef = useRef(null);

  // Analysis Result State
  const [runStatus, setRunStatus] = useState(null);
  const [runData, setRunData] = useState(null);

  const searchRegion = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      const { data } = await geocodeApi.search(q, { limit: 6 });
      setSearchResults(sortResultsByBoundary(data ?? []));
      setIsSearching(false);
    }, 280);
  }, []);

  const enrichGeocodedWithBoundary = useCallback((item, currentGeocoded) => {
    const osmType = item.osm_type ?? currentGeocoded?.osm_type;
    const osmId = item.osm_id ?? currentGeocoded?.osm_id;
    if (!osmType || osmId == null) return;
    geocodeApi.lookup(osmType, osmId).then(({ data }) => {
      if (!data?.[0]) return;
      const looked = parseNominatimResult(data[0]);
      if (hasAreaGeometry(looked)) {
        setSelectedGeocoded(prev => ({
          ...prev,
          boundary_geojson: looked.boundary_geojson,
          bbox: looked.bbox || prev.bbox
        }));
      }
    });
  }, []);

  const handleSelectRegion = (item) => {
    const parsed = parseNominatimResult(item);
    const primaryName = parsed.city || parsed.state || parsed.country || item.display_name.split(",")[0].trim();
    
    setSearchQuery(primaryName);
    setSearchResults([]);
    
    const geocoded = {
      ...parsed,
      display_name: item.display_name,
    };
    setSelectedGeocoded(geocoded);
    enrichGeocodedWithBoundary(item, geocoded);
  };

  const handleRunAnalysis = async () => {
    if (!selectedGeocoded) return;
    setIsAnalyzing(true);
    setShowResults(false);
    setRunData(null);
    setRunStatus("Initializing scan...");
    
    // Convert Nominatim bbox [south, north, west, east] to [west, south, east, north]
    const rawBbox = selectedGeocoded.bbox;
    const bbox = rawBbox?.length === 4
      ? [rawBbox[2], rawBbox[0], rawBbox[3], rawBbox[1]]
      : [-180, -90, 180, 90];

    const payload = {
      region: {
        center: { lat: selectedGeocoded.lat, lon: selectedGeocoded.lon },
        bbox,
        boundary_geojson: selectedGeocoded.boundary_geojson || null,
        display_name: selectedGeocoded.display_name,
      },
      date: analysisDate,
    };

    const { data: triggerData, error: triggerError } = await insightsApi.analyze(payload);

    if (triggerError || !triggerData?.run_id) {
      setIsAnalyzing(false);
      setRunStatus(`Failed: ${triggerError || "Server error"}`);
      return;
    }

    const runId = triggerData.run_id;
    setRunStatus("Processing VV/VH Bands...");

    const pollInterval = setInterval(async () => {
      const { data: pollData, error: pollError } = await insightsApi.getRunDetail(runId);
      
      if (pollError) return; // ignore network blips
      if (!pollData) return;

      setRunStatus(`Status: ${pollData.status}...`);

      if (pollData.status === "completed") {
        clearInterval(pollInterval);
        setIsAnalyzing(false);
        setShowResults(true);
        setRunData(pollData);
      } else if (pollData.status === "failed") {
        clearInterval(pollInterval);
        setIsAnalyzing(false);
        setRunStatus(`Failed: ${pollData.error || "Unknown error"}`);
      }
    }, 3000);
  };

  // Safe extract of result metrics
  const summary = runData?.result?.summary || {};
  const totalImpactArea = summary.total_flood_area_km2 ?? runData?.flood_area_km2 ?? 0;
  const confidence = summary.confidence_avg ?? runData?.confidence_avg ?? 0;
  
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
              <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <GeoSearchInput
                  label="1. Target Region"
                  placeholder="e.g. Larkana, Houston..."
                  value={searchQuery}
                  onChange={(q) => {
                    setSearchQuery(q);
                    searchRegion(q);
                  }}
                  results={searchResults}
                  onSelect={handleSelectRegion}
                  isSearching={isSearching}
                  onClear={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                    setSelectedGeocoded(null);
                  }}
                />
                {selectedGeocoded && (
                    <div className="mt-3 pt-3 border-t border-gray-800 text-xs font-mono text-gray-400">
                       <span className="text-green-500">LAT:</span> {selectedGeocoded.lat.toFixed(4)} <span className="text-green-500 ml-2">LON:</span> {selectedGeocoded.lon.toFixed(4)}
                    </div>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">2. Temporal Window</label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="date" 
                    value={analysisDate}
                    onChange={(e) => setAnalysisDate(e.target.value)}
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
                  disabled={!selectedGeocoded || isAnalyzing}
                  className={`w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                    !selectedGeocoded ? 'bg-gray-100 text-gray-400 cursor-not-allowed' :
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
            
            {/* Empty / Error State */}
            {!isAnalyzing && !showResults && (
               <div className="text-center">
                 <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-4 border border-gray-700">
                   {runStatus?.startsWith("Failed") ? <AlertTriangle className="w-6 h-6 text-red-500" /> : <Satellite className="w-6 h-6 text-gray-500" /> }
                 </div>
                 <p className="text-gray-400 font-medium">
                   {runStatus || "Awaiting target coordinates."}
                 </p>
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
                       <span className="text-sm font-bold text-white tracking-widest uppercase">
                         {runStatus || "Processing VV/VH Bands..."}
                       </span>
                     </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* True Result Map / Image */}
            <AnimatePresence>
              {showResults && runData && (
                <motion.div
                  initial={{ opacity: 0, scale: 1.05 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.8 }}
                  className="absolute inset-0 w-full h-full"
                >
                   {runData.sar_image_url ? (
                      <img 
                        src={runData.sar_image_url} 
                        alt="SAR Detection Result" 
                        className="w-full h-full object-cover"
                      />
                   ) : (
                      <div className="w-full h-full bg-slate-800 relative bg-[url('https://images.unsplash.com/photo-1582293040182-1596796b42b6?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center grayscale filter contrast-125">
                         <div className="absolute inset-0 bg-blue-500/20 mix-blend-overlay"></div>
                         
                         {/* Fallback if no real SAR image generated */}
                         <div className="absolute inset-0 flex items-center justify-center flex-col">
                            <Satellite className="w-16 h-16 text-white/50 mb-4" />
                            <p className="text-white font-mono uppercase tracking-widest bg-black/50 px-4 py-2 rounded">
                               SAR Image Processing Unavailable
                            </p>
                         </div>
                      </div>
                   )}
                   
                   {/* Overlay Top Patch Stats if available */}
                   {runData.patches && runData.patches.length > 0 && (
                      <motion.div 
                         initial={{ opacity: 0, y: 20 }}
                         animate={{ opacity: 1, y: 0 }}
                         transition={{ delay: 0.5 }}
                         className="absolute bottom-6 left-6 right-6 pointer-events-none"
                      >
                         <div className="bg-black/60 backdrop-blur-md p-4 rounded-xl border border-gray-700 flex gap-4 overflow-x-auto shadow-2xl">
                            {runData.patches.slice(0, 3).map((patch, idx) => (
                               <div key={idx} className="bg-white/10 p-3 rounded-lg flex-1 min-w-[200px]">
                                  <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${patch.severity === 'CRITICAL' ? 'text-red-400' : 'text-yellow-400'}`}>
                                     Zone {idx + 1} ({patch.severity})
                                  </div>
                                  <div className="text-white font-medium text-sm">
                                     Area: {patch.area_km2.toFixed(2)} km²
                                  </div>
                                  <div className="text-white/60 text-xs">
                                     Pop: {patch.population_exposed.toLocaleString()}
                                  </div>
                               </div>
                            ))}
                         </div>
                      </motion.div>
                   )}
                </motion.div>
              )}
            </AnimatePresence>

          </div>

          {/* Results Footer Panel */}
          <div className="h-20 border-t border-gray-100 bg-white flex items-center px-6 gap-8">
            {showResults && runData ? (
               <>
                 <div>
                   <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Status</span>
                   <span className="text-sm font-bold text-green-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Scan Complete</span>
                 </div>
                 <div className="w-px h-8 bg-gray-200"></div>
                 <div>
                   <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Confidence</span>
                   <span className="text-sm font-bold text-gray-900">{(confidence * 100).toFixed(1)}% ({confidence > 0.8 ? 'High' : (confidence > 0.5 ? 'Medium' : 'Low')})</span>
                 </div>
                 <div className="w-px h-8 bg-gray-200"></div>
                 <div>
                   <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Total Impact Area</span>
                   <span className="text-sm font-black text-red-500">{totalImpactArea.toFixed(2)} km²</span>
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