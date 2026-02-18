import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validateParams, validateQuery, validateBody } from '../middleware/validate.js';
import { parseIntParam } from '../utils/params.js';
import {
  scheduleSubscriptionJob,
  scheduleImportJob,
  getJobStatus,
  getRecentJobs,
  QUEUE_NAMES,
} from '../jobs/queue.js';
import { createLogger } from '../lib/logger.js';
import {
  jobStatusParamsSchema,
  recentJobsParamsSchema,
  limitQuerySchema,
  jobIdParamSchema,
  runImportBodySchema,
} from '../schemas/jobs.js';

const logger = createLogger('JobsRoute');

export const jobsRouter = Router();

jobsRouter.use(requireAuth);

// Get job status
jobsRouter.get('/status/:queue/:jobId', validateParams(jobStatusParamsSchema), async (req, res) => {
  try {
    const { queue, jobId } = req.params;
    
    if (queue !== QUEUE_NAMES.SUBSCRIPTION && queue !== QUEUE_NAMES.IMPORT) {
      res.status(400).json({ error: 'Invalid queue name' });
      return;
    }

    const status = await getJobStatus(queue, jobId);
    
    if (!status) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({ job: status });
  } catch (error) {
    logger.error('Failed to get job status', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { queue: req.params.queue, jobId: req.params.jobId },
    });
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// Get recent jobs
jobsRouter.get('/recent/:queue', validateParams(recentJobsParamsSchema), validateQuery(limitQuerySchema), async (req, res) => {
  try {
    const { queue } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    
    if (queue !== QUEUE_NAMES.SUBSCRIPTION && queue !== QUEUE_NAMES.IMPORT) {
      res.status(400).json({ error: 'Invalid queue name' });
      return;
    }

    const jobs = await getRecentJobs(queue, limit);
    
    // Enrich jobs with user info
    const userIds = [...new Set(jobs.map(j => j.data?.userId).filter(Boolean))] as number[];
    const users = userIds.length > 0 
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, displayName: true },
        })
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));
    
    const enrichedJobs = jobs.map(job => {
      const userId = job.data?.userId as number | undefined;
      return {
        ...job,
        user: userId ? userMap.get(userId) || null : null,
      };
    });
    
    res.json({ jobs: enrichedJobs });
  } catch (error) {
    logger.error('Failed to get recent jobs', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { queue: req.params.queue },
    });
    res.status(500).json({ error: 'Failed to get recent jobs' });
  }
});

// Run subscription now
jobsRouter.post('/run/subscription/:id', validateParams(jobIdParamSchema), async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid subscription ID' });
      return;
    }
    const isAdmin = req.user!.role === 'admin';
    
    // Admins can run any subscription, users can only run their own
    const subscription = await prisma.subscription.findFirst({
      where: isAdmin ? { id } : { id, userId: req.user!.id },
    });

    if (!subscription) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    // Use the subscription owner's userId so their connections are used
    const job = await scheduleSubscriptionJob(id, subscription.userId);
    
    res.json({ success: true, jobId: job.id });
  } catch (error) {
    logger.error('Failed to schedule subscription job', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { subscriptionId: parseIntParam(req.params.id) },
    });
    res.status(500).json({ error: 'Failed to schedule job' });
  }
});
jobsRouter.post('/run/import/:id', validateParams(jobIdParamSchema), validateBody(runImportBodySchema), async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid import ID' });
      return;
    }
    const { mode } = req.body;
    const isAdmin = req.user!.role === 'admin';
    
    // Admins can run any import, users can only run their own
    const importSource = await prisma.importSource.findFirst({
      where: isAdmin ? { id } : { id, userId: req.user!.id },
    });

    if (!importSource) {
      res.status(404).json({ error: 'Import source not found' });
      return;
    }

    // Use the import source owner's userId so their connections are used
    const job = await scheduleImportJob(
      id,
      importSource.userId,
      mode || importSource.resultHandling
    );
    
    res.json({ success: true, jobId: job.id });
  } catch (error) {
    logger.error('Failed to schedule import job', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { importId: parseIntParam(req.params.id) },
    });
    res.status(500).json({ error: 'Failed to schedule job' });
  }
});

// Get subscription run history
jobsRouter.get('/history/subscription/:id', validateParams(jobIdParamSchema), validateQuery(limitQuerySchema), async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid subscription ID' });
      return;
    }
    const limit = parseInt(req.query.limit as string, 10) || 20;
    
    const subscription = await prisma.subscription.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!subscription) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    const runs = await prisma.subscriptionRun.findMany({
      where: { subscriptionId: id },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    res.json({ runs });
  } catch (error) {
    logger.error('Failed to get run history', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { subscriptionId: parseIntParam(req.params.id) },
    });
    res.status(500).json({ error: 'Failed to get run history' });
  }
});
