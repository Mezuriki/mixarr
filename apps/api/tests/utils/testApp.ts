/**
 * Test App Factory
 * 
 * Creates a configured Express app for integration testing
 * with proper mocking of external services
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { User } from '@prisma/client';

// Session mock
declare global {
  namespace Express {
    interface Request {
      user?: User;
      isAuthenticated(): boolean;
      login(user: User, callback: (err?: Error) => void): void;
      logout(callback: (err?: Error) => void): void;
    }
  }
}

export interface TestAppOptions {
  mockUser?: User | null;
  mockPrisma?: ReturnType<typeof import('./fixtures.js').createMockPrisma>;
}

/**
 * Create a test Express app with optional authenticated user
 */
export function createTestApp(options: TestAppOptions = {}): Express {
  const app = express();
  
  app.use(express.json());
  
  // Mock authentication middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (options.mockUser) {
      req.user = options.mockUser;
      req.isAuthenticated = () => true;
    } else {
      req.isAuthenticated = () => false;
    }
    req.login = (user: User, cb: (err?: Error) => void) => {
      req.user = user;
      cb();
    };
    req.logout = (cb: (err?: Error) => void) => {
      req.user = undefined;
      cb();
    };
    next();
  });
  
  return app;
}

/**
 * Error handler for test app
 */
export function testErrorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error('Test error:', err);
  res.status(500).json({ error: err.message });
}
