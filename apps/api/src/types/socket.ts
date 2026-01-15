import { Session, SessionData } from 'express-session';
import { Socket } from 'socket.io';
import { IncomingMessage } from 'http';

/**
 * Extended IncomingMessage that includes express-session data.
 * Used for Socket.IO handshake requests after session middleware processes them.
 */
export interface SessionIncomingMessage extends IncomingMessage {
  session: Session & Partial<SessionData>;
  sessionID: string;
}

/**
 * Socket.IO socket with session-authenticated request.
 * The request property is typed to include session data after middleware processing.
 */
export interface AuthenticatedSocket extends Socket {
  request: SessionIncomingMessage;
  /** User ID attached after successful authentication */
  userId?: number;
}

/**
 * Minimal response-like object for express-session middleware.
 * Socket.IO doesn't provide a real response, but express-session
 * only needs an object it won't throw on.
 */
export type SocketSessionResponse = Record<string, unknown>;
