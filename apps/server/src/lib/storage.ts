import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';

/**
 * Private receipt storage on the local filesystem. Files are stored under random keys outside any
 * static directory and are only streamed through an authorized endpoint. Swap this module for an
 * S3/GCS implementation with the same interface in production.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

/** Detects the real file type from its content; the client-declared MIME type is not trusted. */
export function detectFileType(buffer: Buffer): { mime: string; ext: string } | null {
  const match = SIGNATURES.find((s) => s.test(buffer));
  return match ? { mime: match.mime, ext: match.ext } : null;
}

function resolveKey(key: string): string {
  if (!/^[a-f0-9]{48}\.[a-z]{3,4}$/.test(key)) throw new Error('Invalid storage key');
  return path.join(env.storageDir, 'receipts', key);
}

export async function saveFile(buffer: Buffer, ext: string): Promise<string> {
  const key = `${crypto.randomBytes(24).toString('hex')}.${ext}`;
  const target = resolveKey(key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, buffer, { flag: 'wx' });
  return key;
}

export function openFile(key: string): fs.ReadStream {
  return fs.createReadStream(resolveKey(key));
}

export async function fileExists(key: string): Promise<boolean> {
  try {
    await fsp.access(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

export async function removeFile(key: string): Promise<void> {
  await fsp.rm(resolveKey(key), { force: true });
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  return base || 'receipt';
}
