/**
 * Subscription Controller
 * 
 * HTTP handling layer for subscription CRUD operations.
 * Delegates all business logic to SubscriptionService.
 */

import type { Request, Response, NextFunction } from 'express';
import { subscriptionService, NotFoundError } from '../services/subscriptions.service.js';

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
      res.json(subscriptions);
    } catch (error) {
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
      res.json(subscription);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
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
      res.status(201).json(subscription);
    } catch (error) {
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
      res.json(subscription);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
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
      next(error);
    }
  }
}

// Export a singleton instance for convenience
export const subscriptionController = new SubscriptionController();
