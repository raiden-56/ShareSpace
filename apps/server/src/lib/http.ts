import type { ErrorRequestHandler, Request } from 'express';
import { z, type ZodType } from 'zod';
import { Prisma } from '@prisma/client';
import { log } from './log';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, 'BAD_REQUEST', details);
export const unauthorized = (message = 'Please sign in to continue') => new HttpError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, message, 'FORBIDDEN');
export const notFound = (message = 'Not found') => new HttpError(404, message, 'NOT_FOUND');
export const conflict = (message: string, code = 'CONFLICT') => new HttpError(409, message, code);

/** Parses a request body/query with a shared Zod schema, returning field-level errors on failure. */
export function parse<T extends ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = result.error.issues[0];
    throw badRequest(first ? `${first.path.length ? `${first.path.join('.')}: ` : ''}${first.message}` : 'Invalid request', { fields });
  }
  return result.data;
}

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) throw notFound();
  return value;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: { message: 'This record already exists', code: 'DUPLICATE' } });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
      return;
    }
  }
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
    res.status(413).json({ error: { message: 'Request is too large', code: 'TOO_LARGE' } });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: { message: 'Malformed JSON body', code: 'BAD_REQUEST' } });
    return;
  }
  // Never leak internals to the client; log a short message server-side without request bodies.
  log.error(`${req.method} ${req.path} failed: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack && !process.env.NODE_ENV?.startsWith('prod')) log.debug(err.stack);
  res.status(500).json({ error: { message: 'Something went wrong. Please try again.', code: 'INTERNAL' } });
};
