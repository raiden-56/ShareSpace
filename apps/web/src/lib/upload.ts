import { CSRF_HEADER } from '../api/api';
import { GUEST_MODE_ENABLED, isGuestActive } from '../guest/mode';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export function validateUpload(file: File): string | null {
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) return 'Only JPEG, PNG, WebP, GIF images and PDF files are supported.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Files must be 10 MB or smaller.';
  if (file.size === 0) return 'This file is empty.';
  return null;
}

/** Uploads a receipt with progress reporting (fetch has no upload progress, so XHR is used). */
export function uploadReceipt(
  groupId: string,
  expenseId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<void>; abort: () => void } {
  if (GUEST_MODE_ENABLED && isGuestActive()) {
    // Guest mode: the file stays in this browser tab as an object URL.
    const promise = import('../guest/server').then(({ guestUpload }) => guestUpload(groupId, expenseId, file, onProgress));
    return { promise, abort: () => undefined };
  }
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('POST', `/api/groups/${groupId}/expenses/${expenseId}/attachments`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', CSRF_HEADER['X-Requested-With']);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = 'Upload failed. Please try again.';
        try {
          message = (JSON.parse(xhr.responseText) as { error?: { message?: string } }).error?.message ?? message;
        } catch {
          /* ignore */
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
