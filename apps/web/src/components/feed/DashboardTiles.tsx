'use client';

import { useDashboardStats } from '@/lib/hooks';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Users from 'lucide-react/dist/esm/icons/users';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Link2 from 'lucide-react/dist/esm/icons/link-2';

interface StatTileProps {
  icon: React.ReactNode;
  value: number;
  label: string;
  colorClass: string;
  iconBgClass: string;
}

function StatTile({ icon, value, label, colorClass, iconBgClass }: StatTileProps) {
  return (
    <div className="group relative bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 transition-all duration-300 hover:translate-y-[-4px] hover:shadow-lg hover:shadow-black/20 hover:border-slate-600/50 overflow-hidden">
      {/* Top accent bar on hover */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${colorClass} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
      
      {/* Icon */}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${iconBgClass}`}>
        {icon}
      </div>
      
      {/* Value */}
      <div className="text-3xl font-bold text-white mb-1">{value.toLocaleString()}</div>
      
      {/* Label */}
      <div className="text-sm text-gray-400 font-medium">{label}</div>
    </div>
  );
}

function StatTileSkeleton() {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 animate-pulse">
      <div className="w-12 h-12 rounded-xl bg-slate-700/50 mb-4" />
      <div className="h-8 w-16 bg-slate-700/50 rounded mb-2" />
      <div className="h-4 w-24 bg-slate-700/50 rounded" />
    </div>
  );
}

export function DashboardTiles() {
  const { data: stats, isLoading, error } = useDashboardStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
    );
  }

  if (error || !stats) {
    return null; // Silently fail - not critical for the page
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <StatTile
        icon={<RefreshCw className="w-6 h-6 text-blue-400" />}
        value={stats.activeSubscriptions}
        label="Active Subscriptions"
        colorClass="bg-gradient-to-r from-blue-500 to-cyan-500"
        iconBgClass="bg-blue-500/10"
      />
      <StatTile
        icon={<Users className="w-6 h-6 text-pink-400" />}
        value={stats.artistsAdded}
        label="Artists Added (30d)"
        colorClass="bg-gradient-to-r from-pink-500 to-violet-500"
        iconBgClass="bg-pink-500/10"
      />
      <StatTile
        icon={<Clock className="w-6 h-6 text-cyan-400" />}
        value={stats.pendingReviews}
        label="Pending Reviews"
        colorClass="bg-gradient-to-r from-cyan-500 to-blue-500"
        iconBgClass="bg-cyan-500/10"
      />
      <StatTile
        icon={<Link2 className="w-6 h-6 text-green-400" />}
        value={stats.activeConnections}
        label="Active Connections"
        colorClass="bg-gradient-to-r from-green-500 to-cyan-500"
        iconBgClass="bg-green-500/10"
      />
    </div>
  );
}
