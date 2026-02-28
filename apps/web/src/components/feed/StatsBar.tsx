import Clock from 'lucide-react/dist/esm/icons/clock';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';

export interface StatsBarProps {
  pending: number;
  addedToday: number;
}

export function StatsBar({ pending, addedToday }: StatsBarProps) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        <span className="tabular-nums font-medium">{pending}</span> pending
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        <span className="tabular-nums font-medium">{addedToday}</span> added today
      </span>
    </div>
  );
}
