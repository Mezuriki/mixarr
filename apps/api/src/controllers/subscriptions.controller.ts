/**
 * Subscription Controller
 * 
 * HTTP handling layer for subscription CRUD operations.
 * Delegates all business logic to SubscriptionService.
 */

import type { Request, Response, NextFunction } from 'express';
import { subscriptionService, NotFoundError } from '../services/subscriptions.service.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('SubscriptionsController');

/**
 * Parse integer from string, return null if invalid
 */
function parseId(value: string): number | null {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Controller class for subscription HTTP endpoints
 */
export class SubscriptionController {
  /**
   * GET /subscriptions
   * List all subscriptions for the authenticated user
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscriptions = await subscriptionService.findAll(req.user!.id);
      res.json({ subscriptions });
    } catch (error) {
      logger.error('Failed to list subscriptions', {
        error: error instanceof Error ? error.message : String(error),
        userId: req.user?.id,
      });
      next(error);
    }
  }

  /**
   * GET /subscriptions/:id
   * Get a single subscription by ID
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid subscription ID' });
        return;
      }

      const subscription = await subscriptionService.findById(id, req.user!.id);
      res.json({ subscription });
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      logger.error('Failed to get subscription', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id,
        userId: req.user?.id,
      });
      next(error);
    }
  }

  /**
   * POST /subscriptions
   * Create a new subscription
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await subscriptionService.create(req.user!.id, req.body);
      res.status(201).json({ subscription });
    } catch (error) {
      logger.error('Failed to create subscription', {
        error: error instanceof Error ? error.message : String(error),
        userId: req.user?.id,
        name: req.body?.name,
      });
      next(error);
    }
  }

  /**
   * PUT/PATCH /subscriptions/:id
   * Update an existing subscription
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid subscription ID' });
        return;
      }

      const subscription = await subscriptionService.update(id, req.user!.id, req.body);
      res.json({ subscription });
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      logger.error('Failed to update subscription', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id,
        userId: req.user?.id,
      });
      next(error);
    }
  }

  /**
   * DELETE /subscriptions/:id
   * Delete a subscription
   */
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid subscription ID' });
        return;
      }

      await subscriptionService.delete(id, req.user!.id);
      res.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      logger.error('Failed to delete subscription', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id,
        userId: req.user?.id,
      });
      next(error);
    }
  }

  /**
   * POST /subscriptions/:id/execute
   * Manually execute a subscription
   */
  async execute(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid subscription ID' });
        return;
      }

      const result = await subscriptionService.execute(id, req.user!.id);
      res.json(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      logger.error('Failed to execute subscription', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id,
        userId: req.user?.id,
      });
      next(error);
    }
  }

  /**
   * GET /subscriptions/:id/runs
   * Get run history for a subscription
   */
  async getRunHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid subscription ID' });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await subscriptionService.getRunHistory(id, req.user!.id, limit, offset);
      res.json({ ...result, limit, offset });
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      logger.error('Failed to get run history', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id,
        userId: req.user?.id,
      });
      next(error);
    }
  }

  /**
   * GET /subscriptions/:id/runs/:runId
   * Get run details with results
   */
  async getRunDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseId(req.params.id);
      const runId = parseId(req.params.runId);

      if (id === null) {
        res.status(400).json({ error: 'Invalid subscription ID' });
        return;
      }
      if (runId === null) {
        res.status(400).json({ error: 'Invalid run ID' });
        return;
      }

      const result = await subscriptionService.getRunDetails(id, runId, req.user!.id);
      if (!result) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      res.json(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      logger.error('Failed to get run details', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id,
        runId: req.params.runId,
        userId: req.user?.id,
      });
      next(error);
    }
  }
}

// Export a singleton instance for convenience
export const subscriptionController = new SubscriptionController();
