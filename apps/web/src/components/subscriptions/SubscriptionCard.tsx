'use client';

import Link from 'next/link';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Edit from 'lucide-react/dist/esm/icons/edit';
import Eye from 'lucide-react/dist/esm/icons/eye';
import Pause from 'lucide-react/dist/esm/icons/pause';
import Play from 'lucide-react/dist/esm/icons/play';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import { Button, Card, CardContent, Badge } from '@/components/ui';
import { subscriptionTypes, scheduleOptions } from '@/lib/subscription-constants';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * User type for ownership display
 */
export interface User {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

/**
 * Subscription data structure
 */
export interface Subscription {
  id: number;
  userId: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  schedule: string | null;
  resultHandling: 'preview' | 'queue' | 'auto';
  isActive: boolean;
  lastRun: string | null;
  lastRunStatus: 'success' | 'completed' | 'failed' | 'running' | null;
  lastRunCount: number | null;
  nextRun: string | null;
  user?: { username: string; displayName: string };
}

// ============================================================================
// Component Props
// ============================================================================

export interface SubscriptionCardProps {
  /** The subscription data to display */
  subscription: Subscription;
  /** Current authenticated user (for admin badge display) */
  currentUser: User | null;
  /** Whether the subscription is currently being executed */
  isRunning: boolean;
  /** Handler for running the subscription */
  onRun: (id: number) => void;
  /** Handler for toggling the subscription active state */
  onToggle: (subscription: Subscription) => void;
  /** Handler for editing the subscription */
  onEdit: (subscription: Subscription) => void;
  /** Handler for deleting the subscription */
  onDelete: (id: number) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * SubscriptionCard displays a single subscription with its status, info, and action buttons.
 *
 * Features:
 * - Icon based on subscription type
 * - Active/Paused badge
 * - Last run status badge with artist count
 * - Owner badge (for admins viewing other users' subscriptions)
 * - Schedule and last run info
 * - Action buttons: View, Run, Toggle, Edit, Delete
 */
export function SubscriptionCard({
  subscription: sub,
  currentUser: user,
  isRunning,
  onRun,
  onToggle,
  onEdit,
  onDelete,
}: SubscriptionCardProps) {
  // Get the icon for this subscription type
  const SubIcon = subscriptionTypes.find(t => t.value === sub.type)?.icon || TrendingUp;

  // Get the type label
  const typeLabel = subscriptionTypes.find(t => t.value === sub.type)?.label;

  // Get the schedule label
  const scheduleLabel = scheduleOptions.find(s => s.value === sub.schedule)?.label || sub.schedule;

  // Build additional info string (country, tag)
  const additionalInfo: string[] = [];
  if (typeof sub.config.country === 'string' && sub.config.country !== 'global') {
    additionalInfo.push(sub.config.country);
  }
  if (typeof sub.config.tag === 'string') {
    additionalInfo.push(sub.config.tag);
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className="rounded-lg bg-primary/10 p-3 text-primary">
            <SubIcon className="h-5 w-5" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Header row with name and badges */}
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">
                {sub.name}
              </h3>
              <Badge variant={sub.isActive ? 'success' : 'secondary'}>
                {sub.isActive ? 'Active' : 'Paused'}
              </Badge>
              {sub.lastRunStatus && (
                <Badge
                  variant={
                    sub.lastRunStatus === 'success' || sub.lastRunStatus === 'completed'
                      ? 'success'
                      : sub.lastRunStatus === 'failed'
                        ? 'destructive'
                        : 'secondary'
                  }
                  className="text-xs"
                >
                  {sub.lastRunStatus === 'success' || sub.lastRunStatus === 'completed'
                    ? `✓ ${sub.lastRunCount ?? 0} artists`
                    : sub.lastRunStatus === 'failed'
                      ? '✗ Failed'
                      : '⟳ Running'}
                </Badge>
              )}
              {/* Show owner badge for admins viewing other users' subscriptions */}
              {user?.role === 'admin' && sub.user && sub.userId !== user.id && (
                <Badge variant="outline" className="text-xs">
                  {sub.user.displayName || sub.user.username}
                </Badge>
              )}
            </div>

            {/* Type and additional info */}
            <p className="text-sm text-muted-foreground">
              {typeLabel}
              {additionalInfo.length > 0 && ` · ${additionalInfo.join(' · ')}`}
            </p>

            {/* Schedule and last run */}
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              {sub.schedule && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {scheduleLabel}
                </span>
              )}
              {sub.lastRun && (
                <span>Last: {new Date(sub.lastRun).toLocaleDateString()}</span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            <Link href={`/subscriptions/${sub.id}`}>
              <Button variant="ghost" size="icon" title="View results">
                <Eye className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRun(sub.id)}
              disabled={isRunning}
              title="Run now"
            >
              <Play className={`h-4 w-4 ${isRunning ? 'animate-pulse' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onToggle(sub)}
              title={sub.isActive ? 'Pause' : 'Resume'}
            >
              {sub.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onEdit(sub)} title="Edit">
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onDelete(sub.id)} title="Delete">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
