import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('DashboardRoute');

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

// Get dashboard stats
dashboardRouter.get('/stats', async (req, res) => {
  try {
    const userId = req.user!.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      activeSubscriptions,
      artistsAddedViaSubscriptions,
      artistsAddedViaReviewQueue,
      pendingReviews,
      recentRuns,
      activeConnections
    ] = await Promise.all([
      // Active subscriptions count
      prisma.subscription.count({
        where: { userId, isActive: true }
      }),
      
      // Artists added in last 30 days via subscriptions/feed (SubscriptionResult)
      prisma.subscriptionResult.count({
        where: {
          subscription: { userId },
          status: 'added',
          processedAt: { gte: thirtyDaysAgo }
        }
      }),

      // Artists added in last 30 days via review queue (ReviewItem)
      // See TD-009: these two "added" tracking paths should be unified
      prisma.reviewItem.count({
        where: {
          userId,
          status: 'approved',
          updatedAt: { gte: thirtyDaysAgo }
        }
      }),
      
      // Pending review items
      prisma.reviewItem.count({
        where: { userId, status: 'pending' }
      }),
      
      // Recent runs for job count
      prisma.subscriptionRun.count({
        where: {
          subscription: { userId },
          status: 'running'
        }
      }),

      // Active connections count
      prisma.connection.count({
        where: { userId, isActive: true }
      })
    ]);

    const artistsAdded = artistsAddedViaSubscriptions + artistsAddedViaReviewQueue;

    res.json({
      stats: {
        activeSubscriptions,
        artistsAdded,
        pendingReviews,
        runningJobs: recentRuns,
        activeConnections
      }
    });
  } catch (error) {
    logger.error('Failed to fetch dashboard stats', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch stats' 
    });
  }
});

// Get recent activity
dashboardRouter.get('/activity', async (req, res) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 10;

    // Get recent subscription runs
    const recentRuns = await prisma.subscriptionRun.findMany({
      where: { subscription: { userId } },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        subscription: {
          select: { name: true, type: true }
        }
      }
    });

    const activities = recentRuns.map(run => ({
      id: run.id,
      type: 'subscription_run' as const,
      title: run.subscription.name,
      description: run.status === 'completed' 
        ? `Added ${run.addedCount} artists, skipped ${run.skippedCount}`
        : run.status === 'failed'
        ? `Failed: ${run.errorMessage}`
        : 'Running...',
      status: run.status,
      timestamp: run.completedAt || run.startedAt
    }));

    res.json({ activities });
  } catch (error) {
    logger.error('Failed to fetch activity', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch activity' 
    });
  }
});

// Get connection status summary
dashboardRouter.get('/connections/summary', async (req, res) => {
  try {
    const userId = req.user!.id;

    const connections = await prisma.connection.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        type: true,
        isActive: true,
        lastTest: true
      }
    });

    const summary = {
      total: connections.length,
      active: connections.filter(c => c.isActive).length,
      connections: connections.map(c => ({
        type: c.type,
        name: c.name,
        isActive: c.isActive,
        lastChecked: c.lastTest
      }))
    };

    res.json({ summary });
  } catch (error) {
    logger.error('Failed to fetch connection summary', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch connection summary' 
    });
  }
});
