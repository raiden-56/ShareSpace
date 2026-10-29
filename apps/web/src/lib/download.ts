import { CSRF_HEADER } from '../api/api';
import { GUEST_MODE_ENABLED, isGuestActive } from '../guest/mode';

/**
 * Downloads an authenticated API file (CSV/JSON export) with fetch so the session cookie is sent,
 * then saves it under the filename the server provides.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const { name, blob } = GUEST_MODE_ENABLED && isGuestActive() ? await guestFile(url) : await fetchFile(url, fallbackName);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

async function fetchFile(url: string, fallbackName: string): Promise<{ name: string; blob: Blob }> {
  const res = await fetch(url, { credentials: 'same-origin', headers: CSRF_HEADER });
  if (!res.ok) {
    let message = 'Export failed. Please try again.';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  return { name, blob: await res.blob() };
}

/** Guest mode: the export is generated in the browser from the sample data. */
async function guestFile(url: string): Promise<{ name: string; blob: Blob }> {
  const { guestDownload } = await import('../guest/server');
  const { fileName, blob } = await guestDownload(url);
  return { name: fileName, blob };
}
