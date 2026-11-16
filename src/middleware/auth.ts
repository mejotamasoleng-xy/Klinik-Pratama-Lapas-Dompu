/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export const optionalOrRequiredAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // For single shared clinic session in clinic environment, permit access
    return next();
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const { adminAuth } = await import('../lib/firebase-admin.ts');
    if (!adminAuth) {
      return next();
    }
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch {
    // Proceed if verifying fails in dev/proxy or proceed without crash
    next();
  }
};
