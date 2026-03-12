import React, { useState } from "react";
import { motion } from "framer-motion";
import { 
  Activity, 
  TrendingUp, 
  SlidersHorizontal,
  CloudRain,
  Thermometer,
  Layers,
  Map as MapIcon,
  Crosshair,
  Maximize2
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid, 
  BarChart, 
  Bar, 
  Cell
} from "recharts";
import PageHeader from "../components/common/PageHeader.jsx";

// Mock Data
const TIMELINE_DATA = Array.from({ length: 14 }).map((_, i) => ({
  day: `Day ${i + 1}`,
  prob: [12, 14, 18, 25, 45, 85, 92, 88, 75, 50, 35, 20, 15, 12][i]
}));

const FEATURES_DATA = [
  { name: "Rain 24h", value: 35, color: "#ef4444" },
  { name: "Soil Moisture", value: 25, color: "#f97316" },
  { name: "Elevation", value: 20, color: "#eab308" },
  { name: "Land Cover", value: 15, color: "#22c55e" },
  { name: "Temp Anomaly", value: 5, color: "#3b82f6" }
];

export default function Forecast() {
  const [prob, setProb] = useState(85);
  const [features, setFeatures] = useState({
    precip: 140,
    soil: 80,
    temp: 24
  });

  const getAlertColor = (p) => {
    if (p >= 80) return "text-red-500";
    if (p >= 50) return "text-orange-500";
    return "text-green-500";
  };

  const getAlertBg = (p) => {
    if (p >= 80) return "bg-red-50";
    if (p >= 50) return "bg-orange-50";
    return "bg-green-50";
  };
  
  const getAlertBadgeColor = (p) => {
    if (p >= 80) return "bg-red-500 text-white";
    if (p >= 50) return "bg-orange-500 text-white";
    return "bg-green-500 text-white";
  }

  const alertLevel = prob >= 80 ? "CRITICAL" : prob >= 50 ? "WARNING" : "NORMAL";

  const handleSliderChange = (e, key) => {
    const val = parseInt(e.target.value);
    setFeatures(prev => ({ ...prev, [key]: val }));
    
    // Fake prediction effect
    const newProb = Math.min(100, Math.max(0, 85 + (val - 100) * 0.5));
    setProb(Math.round(newProb));
  };

  return (
    <div className="flex flex-col min-h-screen pt-14 bg-gray-50 font-sans selection:bg-green-100 selection:text-green-900">
      
      <PageHeader 
        title="14-Day Trajectory Forecast"
        subtitle="District-level predictive modeling based on live meteorological features."
        icon={Activity}
      />

      <div className="flex-1 max-w-7xl mx-auto w-full p-6 grid lg:grid-cols-12 gap-6 h-full">
        
        {/* ── Left Sidebar/Main Area: Map & Timeline ── */}
        <div className="lg:col-span-8 flex flex-col gap-6 h-full">
          
          {/* Top: Predictive Map Viewport */}
          <div className="flex flex-col h-[60%] bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden relative">
            <div className="h-14 border-b border-gray-100 flex items-center justify-between px-6 bg-gray-50/50">
              <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <MapIcon className="w-4 h-4 text-green-500" /> Predictive Heatmap Overlay
              </span>
              <div className="flex gap-2">
                 <button className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"><Layers className="w-4 h-4" /></button>
                 <button className="p-1.5 rounded hover:bg-gray-200 text-gray-500 transition-colors"><Maximize2 className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="flex-1 bg-gray-100 relative overflow-hidden flex items-center justify-center">
              {/* Fake Map Image Overlay */}
              <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center grayscale filter contrast-125 opacity-30"></div>
              
              {/* Dynamic Heatmap Blob based on Probability */}
              <motion.div 
                animate={{ 
                  scale: 1 + (prob / 100) * 0.5,
                  opacity: prob / 100
                }}
                className={`absolute w-96 h-96 blur-3xl rounded-full mix-blend-multiply ${prob >= 80 ? 'bg-red-500/40' : prob >= 50 ? 'bg-orange-500/40' : 'bg-green-500/40'}`}
              />

              {/* Data Marker Overlay */}
               <motion.div 
                 className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-2 rounded-xl backdrop-blur-md shadow-lg border border-white/20 flex flex-col items-center ${getAlertBadgeColor(prob)}`}
               >
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">Peak Risk</span>
                  <span className="text-3xl font-black">{prob}%</span>
               </motion.div>
            </div>
          </div>

          {/* Bottom: 14-Day Timeline Chart */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex-1 min-h-[300px]">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-6 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-gray-400" />
              14-Day Probability Timeline
            </h3>
            <div className="w-full h-[calc(100%-2rem)] ml-[-15px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={TIMELINE_DATA}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '13px', fontWeight: 'bold' }}
                  />
                  {/* Dynamic Color Line based on final projected state */}
                  <Line 
                    type="monotone" 
                    dataKey="prob" 
                    stroke={prob >= 80 ? "#ef4444" : prob >= 50 ? "#f97316" : "#22c55e"} 
                    strokeWidth={4} 
                    dot={{ fill: prob >= 80 ? "#ef4444" : prob >= 50 ? "#f97316" : "#22c55e", r: 4 }} 
                    activeDot={{ r: 7 }} 
                    name="Probability %"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* ── Right Sidebar: Forecast Analytics & What-If ── */}
        <aside className="lg:col-span-4 flex flex-col gap-6 w-full relative">
          
          {/* Status KPI */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-6">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Selected Region</span>
                <h2 className="text-xl font-black text-gray-900 mt-1">District C, South</h2>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${getAlertBadgeColor(prob)}`}>
                {alertLevel}
              </span>
            </div>

            {/* Probability Gauge */}
            <div className="text-center py-8 bg-gray-50 rounded-2xl border border-gray-100 relative overflow-hidden">
              <div className={`absolute -inset-10 opacity-10 bg-[radial-gradient(circle_at_bottom,${getAlertColor(prob).replace('text-', '')},transparent_70%)]`}></div>
              <div className="relative z-10">
                <span className={`text-7xl font-black tracking-tighter ${getAlertColor(prob)}`}>{prob}%</span>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-3">Peak Probability (Day 6-7)</p>
              </div>
            </div>
          </div>

          {/* Feature Importance */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-6 flex items-center gap-2">
              <Layers className="w-4 h-4 text-gray-400" />
              Model Feature Importance
            </h3>
            <div className="h-44 w-full ml-[-20px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={FEATURES_DATA} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 700, fill: '#4b5563' }} width={100} />
                  <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '12px', border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                    {FEATURES_DATA.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Interactive What-If Sliders */}
          <div className="bg-white rounded-3xl p-6 pb-8 shadow-sm border border-gray-100 flex-1 border-t-4 border-t-green-500">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-2 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-gray-400" />
              Interactive "What-If" Matrix
            </h3>
            <p className="text-xs text-gray-500 mb-6 font-medium">Manipulate live data streams to see how probabilities rapidly shift.</p>
            
            <div className="space-y-7">
              <div>
                <div className="flex justify-between text-xs font-bold text-gray-700 mb-3">
                  <span className="flex items-center gap-1.5"><CloudRain className="w-4 h-4 text-blue-500" /> Est. Precipitation</span>
                  <span className="bg-gray-100 px-2 py-1 rounded text-gray-900">{features.precip} mm</span>
                </div>
                <input 
                  type="range" min="0" max="300" value={features.precip} 
                  onChange={(e) => handleSliderChange(e, 'precip')}
                  className="w-full accent-blue-500 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              
              <div>
                <div className="flex justify-between text-xs font-bold text-gray-700 mb-3">
                  <span className="flex items-center gap-1.5"><Layers className="w-4 h-4 text-orange-500" /> Soil Moisture Deficit</span>
                  <span className="bg-gray-100 px-2 py-1 rounded text-gray-900">{features.soil} %</span>
                </div>
                <input 
                  type="range" min="0" max="100" value={features.soil} 
                  onChange={(e) => handleSliderChange(e, 'soil')}
                  className="w-full accent-orange-500 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              
              <div>
                <div className="flex justify-between text-xs font-bold text-gray-700 mb-3">
                  <span className="flex items-center gap-1.5"><Thermometer className="w-4 h-4 text-red-500" /> Regional Temp</span>
                  <span className="bg-gray-100 px-2 py-1 rounded text-gray-900">{features.temp} °C</span>
                </div>
                <input 
                  type="range" min="10" max="45" value={features.temp} 
                  onChange={(e) => handleSliderChange(e, 'temp')}
                  className="w-full accent-red-500 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
            
            <div className="mt-8">
               <button className="w-full py-3 bg-gray-900 hover:bg-black text-white rounded-xl text-sm font-bold transition-colors">
                 Save Scenario Snapshot
               </button>
            </div>
          </div>

        </aside>

      </div>
    </div>
  );
}
