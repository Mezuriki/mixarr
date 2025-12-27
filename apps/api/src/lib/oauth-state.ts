/**
 * OAuth State Utilities
 * 
 * Provides HMAC-signed state parameters to prevent tampering during OAuth flows.
 */

import * as crypto from 'crypto';

const STATE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

interface StateData {
  [key: string]: unknown;
  timestamp: number;
}

interface SignedState extends StateData {
  sig: string;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is required for OAuth state signing');
  }
  return secret;
}

/**
 * Creates an HMAC signature for the given data
 */
function createSignature(data: StateData): string {
  const hmac = crypto.createHmac('sha256', getSecret());
  // Sort keys for consistent hashing
  const sortedData = JSON.stringify(data, Object.keys(data).sort());
  hmac.update(sortedData);
  return hmac.digest('hex');
}

/**
 * Creates a signed, base64-encoded state parameter for OAuth
 */
export function createSignedState(data: Omit<StateData, 'timestamp'>): string {
  const stateData: StateData = {
    ...data,
    timestamp: Date.now(),
  };
  
  const signature = createSignature(stateData);
  const signedState: SignedState = {
    ...stateData,
    sig: signature,
  };
  
  return Buffer.from(JSON.stringify(signedState)).toString('base64');
}

/**
 * Verifies and parses a signed state parameter
 * Returns the state data if valid, throws an error if invalid
 */
export function verifySignedState<T extends StateData>(encodedState: string): Omit<T, 'sig'> {
  let signedState: SignedState;
  
  try {
    signedState = JSON.parse(Buffer.from(encodedState, 'base64').toString());
  } catch {
    throw new Error('Invalid state format');
  }
  
  const { sig, ...stateData } = signedState;
  
  // Verify signature
  const expectedSig = createSignature(stateData as StateData);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error('Invalid state signature - possible tampering');
  }
  
  // Verify expiry
  if (Date.now() - stateData.timestamp > STATE_EXPIRY_MS) {
    throw new Error('State expired');
  }
  
  return stateData as unknown as Omit<T, 'sig'>;
}
