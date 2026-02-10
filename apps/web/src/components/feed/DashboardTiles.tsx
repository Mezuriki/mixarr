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
    <div className="group relative bg-card border border-border rounded-card px-4 py-3 transition-all duration-300 hover:translate-y-[-2px] hover:shadow-elevation-2 hover:border-primary/20 overflow-hidden">
      {/* Top accent bar on hover */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${colorClass} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
      
      <div className="flex items-center justify-between">
        {/* Value and Label */}
        <div>
          <div className="text-2xl font-bold text-card-foreground font-display">{value.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
        </div>
        
        {/* Icon */}
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconBgClass}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function StatTileSkeleton() {
  return (
    <div className="bg-card border border-border rounded-card px-4 py-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-12 bg-muted rounded mb-1" />
          <div className="h-3 w-20 bg-muted rounded" />
        </div>
        <div className="w-10 h-10 rounded-lg bg-muted" />
      </div>
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
        icon={<RefreshCw className="w-5 h-5 text-blue-400" />}
        value={stats.activeSubscriptions}
        label="Active Subscriptions"
        colorClass="bg-gradient-to-r from-blue-500 to-cyan-500"
        iconBgClass="bg-blue-500/10"
      />
      <StatTile
        icon={<Users className="w-5 h-5 text-pink-400" />}
        value={stats.artistsAdded}
        label="Artists Added (30d)"
        colorClass="bg-gradient-to-r from-pink-500 to-violet-500"
        iconBgClass="bg-pink-500/10"
      />
      <StatTile
        icon={<Clock className="w-5 h-5 text-cyan-400" />}
        value={stats.pendingReviews}
        label="Pending Reviews"
        colorClass="bg-gradient-to-r from-cyan-500 to-blue-500"
        iconBgClass="bg-cyan-500/10"
      />
      <StatTile
        icon={<Link2 className="w-5 h-5 text-green-400" />}
        value={stats.activeConnections}
        label="Active Connections"
        colorClass="bg-gradient-to-r from-green-500 to-cyan-500"
        iconBgClass="bg-green-500/10"
      />
    </div>
  );
}
