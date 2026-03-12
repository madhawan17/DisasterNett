import React, { useState } from "react";
import { motion } from "framer-motion";
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
import { 
  Activity, 
  Search,
  Filter,
  BarChart3,
  TrendingDown,
  Droplets,
  AlertOctagon,
  Download,
  Calendar,
  Share2
} from "lucide-react";
import PageHeader from "../components/common/PageHeader.jsx";

// Mock Data
const HISTORY_DATA = [
  { month: "Jan", incidents: 12, severity: 4 },
  { month: "Feb", incidents: 8, severity: 3 },
  { month: "Mar", incidents: 25, severity: 8 },
  { month: "Apr", incidents: 42, severity: 9 },
  { month: "May", incidents: 18, severity: 5 },
  { month: "Jun", incidents: 15, severity: 4 },
];

const SEVERITY_DISTRIBUTION = [
  { name: "Low", value: 45, color: "#22c55e" },
  { name: "Medium", value: 30, color: "#f59e0b" },
  { name: "High", value: 18, color: "#ef4444" },
  { name: "Critical", value: 7, color: "#7f1d1d" }
];

export default function FloodInsights() {
  const [selectedRegion, setSelectedRegion] = useState("National Overview");

  return (
    <div className="flex flex-col min-h-screen pt-14 bg-gray-50 font-sans selection:bg-green-100 selection:text-green-900">
      
      <PageHeader 
        title="Flood Insights"
        subtitle="Analyzing past flood data to improve predictive accuracy."
        icon={BarChart3}
      >
        <div className="relative flex-1 sm:w-64">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text" 
            placeholder="Search region history..."
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-green-500/50"
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:border-gray-300 shadow-sm transition-colors">
          <Filter className="w-4 h-4" /> Filters
        </button>
        <button className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-green-500/20 hover:bg-green-600 transition-colors">
          <Download className="w-4 h-4" /> Export
        </button>
      </PageHeader>

      <div className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6">
        
        {/* Top KPI Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                <AlertOctagon className="w-5 h-5 text-orange-500" />
              </div>
              <span className="flex items-center text-xs font-bold text-red-500 bg-red-50 px-2 py-1 rounded-full">
                +12% <TrendingDown className="w-3 h-3 ml-1" />
              </span>
            </div>
            <h3 className="text-3xl font-black text-gray-900 tracking-tighter">8,432</h3>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Total Incidents (YTD)</p>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Droplets className="w-5 h-5 text-blue-500" />
              </div>
            </div>
            <h3 className="text-3xl font-black text-gray-900 tracking-tighter">142<span className="text-lg text-gray-400 ml-1 font-medium">km²</span></h3>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Max Flood Extent</p>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                <Activity className="w-5 h-5 text-green-500" />
              </div>
            </div>
            <h3 className="text-3xl font-black text-gray-900 tracking-tighter">42<span className="text-lg font-medium text-gray-400 ml-1">mins</span></h3>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Avg Response Temp</p>
          </div>
          
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-purple-500" />
              </div>
            </div>
            <h3 className="text-3xl font-black text-gray-900 tracking-tighter">3<span className="text-lg font-medium text-gray-400 ml-1">Events</span></h3>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Recurrence Rate / Yr</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          
          {/* Main Chart */}
          <div className="lg:col-span-2 bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-6">Incident Frequency (6 Month Trend)</h3>
            <div className="h-72 w-full ml-[-20px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={HISTORY_DATA}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: '#9ca3af' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: '#9ca3af' }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '13px', fontWeight: 'bold' }}
                  />
                  <Line type="monotone" dataKey="incidents" stroke="#22c55e" strokeWidth={3} dot={{ fill: '#22c55e', r: 4 }} activeDot={{ r: 6 }} name="Incidents" />
                  <Line type="monotone" dataKey="severity" stroke="#ef4444" strokeWidth={3} dot={{ fill: '#ef4444', r: 4 }} name="Avg Severity" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Severity Distribution */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-6">Severity Distribution</h3>
            <div className="h-52 w-full ml-[-20px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={SEVERITY_DISTRIBUTION} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 700, fill: '#4b5563' }} width={80} />
                  <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '12px', border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                    {SEVERITY_DISTRIBUTION.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="bg-gray-50 rounded-xl p-4 mt-4 border border-gray-100">
              <p className="text-sm text-gray-600 font-medium">
                <strong className="text-gray-900">Observation:</strong> High and Critical severity events have decreased by 14% year-over-year in this region.
              </p>
            </div>
          </div>

        </div>
        
        {/* Recent Reports Table */}
        <div className="bg-white rounded-3xl py-6 shadow-sm border border-gray-100 overflow-hidden">
           <div className="px-6 mb-4 flex justify-between items-center">
             <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest">Recent Historic Events</h3>
           </div>
           
           <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-gray-50 border-y border-gray-100">
                   <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date</th>
                   <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Region</th>
                   <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Severity</th>
                   <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Impacted Area</th>
                   <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">Actions</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-gray-100">
                 {[
                   { date: "May 14, 2025", reg: "Larkana District", sev: "Critical", area: "84.2 km²", color: "text-red-600 bg-red-50" },
                   { date: "Mar 02, 2025", reg: "South Valley", sev: "Medium", area: "12.5 km²", color: "text-yellow-600 bg-yellow-50" },
                   { date: "Dec 18, 2024", reg: "Coastal Highway", sev: "Low", area: "2.1 km²", color: "text-green-600 bg-green-50" },
                   { date: "Oct 05, 2024", reg: "Northern Hub", sev: "Medium", area: "19.8 km²", color: "text-yellow-600 bg-yellow-50" },
                 ].map((row, i) => (
                   <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                     <td className="px-6 py-4 text-sm font-semibold text-gray-900">{row.date}</td>
                     <td className="px-6 py-4 text-sm font-medium text-gray-600">{row.reg}</td>
                     <td className="px-6 py-4">
                       <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border border-transparent ${row.color}`}>
                         {row.sev}
                       </span>
                     </td>
                     <td className="px-6 py-4 text-sm font-black text-gray-700">{row.area}</td>
                     <td className="px-6 py-4 text-right">
                       <button className="text-green-500 hover:text-green-700 font-bold text-sm">View Report</button>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>

      </div>
    </div>
  );
}
