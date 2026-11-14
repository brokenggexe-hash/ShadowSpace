import type { NextFunction, Request, Response } from 'express';
import {
  PLATFORM_OWNER_EMAIL,
  type VerifiedUser,
  verifyFirebaseIdToken,
} from '../config/firebase.ts';
import { fsGetDoc } from '../services/firestoreRest.ts';

export interface AuthedRequest extends Request {
  user?: VerifiedUser;
  idToken?: string;
}

export async function requireSignedIn(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer authorization token' });
    return;
  }
  const token = header.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Empty authorization token' });
    return;
  }
  try {
    const verified = await verifyFirebaseIdToken(token);
    req.user = verified;
    req.idToken = token;
    next();
  } catch (err) {
    res.status(401).json({
      error: 'Invalid or expired authentication token',
      details: err instanceof Error ? err.message : undefined,
    });
  }
}

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer authorization token' });
    return;
  }
  const token = header.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Empty authorization token' });
    return;
  }
  try {
    const verified = await verifyFirebaseIdToken(token);
    if (!verified.emailVerified) {
      res.status(403).json({ error: 'Email address must be verified' });
      return;
    }
    req.user = verified;
    req.idToken = token;
    next();
  } catch (err) {
    res.status(401).json({
      error: 'Invalid or expired authentication token',
      details: err instanceof Error ? err.message : undefined,
    });
  }
}

export async function requirePlatformAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user || !req.idToken) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.email === PLATFORM_OWNER_EMAIL && req.user.emailVerified) {
    next();
    return;
  }
  try {
    const adminDoc = await fsGetDoc(`admins/${req.user.uid}`, req.idToken);
    if (adminDoc) {
      next();
      return;
    }
  } catch {
    // Deny below
  }
  res.status(403).json({ error: 'Platform administrator privileges required' });
}

interface Bucket {
  timestamps: number[];
}

const rateBuckets = new Map<string, Bucket>();

export function rateLimit(namespace: string, maxRequests: number, windowMs: number) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const identity = req.user?.uid || req.ip || 'anonymous';
    const key = `${namespace}:${identity}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key) || { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
    if (bucket.timestamps.length >= maxRequests) {
      res.status(429).json({
        error: 'Rate limit exceeded. Please slow down and try again shortly.',
      });
      return;
    }
    bucket.timestamps.push(now);
    rateBuckets.set(key, bucket);
    next();
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[ShadowSpace API Error]', err);
  if (!res.headersSent) {
    res.status(500).json({ error: message });
  }
}
