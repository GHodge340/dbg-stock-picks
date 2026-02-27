import { TrendingUp, ShieldAlert, Target, BrainCircuit, Globe, Activity, Clock, Zap, BarChart3 } from 'lucide-react';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

async function getWatchlist() {
  const filePath = path.join(process.cwd(), 'public', 'watchlist.json');
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading watchlist.json", e);
  }
  return [];
}

export default async function Dashboard() {
  const stocks = await getWatchlist();
  const lastUpdated = new Date().toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 selection:bg-indigo-500/30">
      {/* Background Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full" />
        <div className="absolute top-[20%] -right-[10%] w-[30%] h-[30%] bg-emerald-500/5 blur-[120px] rounded-full" />
      </div>

      <header className="relative border-b border-slate-800/60 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 to-violet-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Zap className="w-6 h-6 text-white fill-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white uppercase">
                DBG <span className="text-indigo-400">Stock Picks</span>
              </h1>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Analysis Engine
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6 text-sm font-medium">
            <div className="flex flex-col items-end">
              <span className="text-slate-500 text-xs uppercase tracking-tighter">Last Update</span>
              <span className="text-slate-300 font-mono">{lastUpdated}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="relative max-w-7xl mx-auto px-6 py-12">
        {/* Intro Section */}
        <div className="mb-16 max-w-2xl">
          <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-6 leading-tight">
            Institutional-grade <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">momentum analysis</span> powered by AI.
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed">
            Every 15 minutes, our engine scans thousands of tickers, cross-referencing technical breakouts with live social sentiment and real-time news catalysts.
          </p>
        </div>

        {stocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/20">
            <Activity className="w-12 h-12 text-slate-700 mb-4 animate-pulse" />
            <p className="text-slate-500 font-medium italic">Scanning markets for high-probability setups...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {stocks.map((stock: any) => (
              <div key={stock.Symbol} className="group relative bg-[#0f172a]/40 border border-slate-800/60 rounded-[2.5rem] p-1 transition-all duration-500 hover:border-indigo-500/40 hover:bg-[#0f172a]/60">
                <div className="bg-slate-950/40 rounded-[2.3rem] p-8 h-full flex flex-col">
                  
                  {/* Symbol Header */}
                  <div className="flex justify-between items-start mb-8">
                    <div className="flex items-center gap-4">
                      <div className="text-5xl font-black text-white tracking-tighter group-hover:text-indigo-400 transition-colors">
                        {stock.Symbol}
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 text-[10px] font-bold uppercase tracking-widest border border-indigo-500/20">
                          Score: {stock.Score}
                        </span>
                        <span className="text-slate-500 text-[10px] font-bold uppercase flex items-center gap-1">
                          <BarChart3 className="w-3 h-3" /> Momentum
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-1">Entry Price</div>
                      <div className="text-3xl font-mono font-medium text-white tracking-tighter">${stock['Buy Price']}</div>
                    </div>
                  </div>

                  {/* Profit/Stop Grid */}
                  <div className="grid grid-cols-2 gap-4 mb-8">
                    <div className="relative group/stat p-5 rounded-3xl bg-emerald-500/[0.03] border border-emerald-500/10 transition-colors hover:bg-emerald-500/[0.06]">
                      <div className="flex items-center gap-2 text-emerald-500/80 mb-2">
                        <Target className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Profit Target</span>
                      </div>
                      <div className="text-2xl font-mono font-bold text-emerald-400">${stock.Target}</div>
                      <div className="text-[10px] font-bold text-emerald-600/80 mt-1 uppercase">+7.00% Upside</div>
                    </div>

                    <div className="relative group/stat p-5 rounded-3xl bg-rose-500/[0.03] border border-rose-500/10 transition-colors hover:bg-rose-500/[0.06]">
                      <div className="flex items-center gap-2 text-rose-500/80 mb-2">
                        <ShieldAlert className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Stop Loss</span>
                      </div>
                      <div className="text-2xl font-mono font-bold text-rose-400">${stock.Stop}</div>
                      <div className="text-[10px] font-bold text-rose-600/80 mt-1 uppercase">-3.50% Safety</div>
                    </div>
                  </div>

                  {/* AI Thesis */}
                  <div className="mt-auto relative p-6 rounded-[2rem] bg-indigo-500/[0.03] border border-indigo-500/10 overflow-hidden">
                    <div className="absolute -right-4 -top-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                      <BrainCircuit className="w-24 h-24" />
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1 rounded bg-indigo-500/20">
                        <BrainCircuit className="w-3.5 h-3.5 text-indigo-400" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Gemini Analyst Insight</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed text-sm italic relative z-10">
                      "{stock['AI Thesis']}"
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-20 flex flex-col md:flex-row items-center justify-between gap-8 pt-12 border-t border-slate-900">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-600" />
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Scanned 2x Daily</span>
            </div>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-600" />
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Live Momentum</span>
            </div>
          </div>
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-[0.2em]">
            © 2026 DBG Stock Picks • Built for modern traders
          </p>
        </div>
      </main>
    </div>
  );
}
