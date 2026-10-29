/**
 * Guest mode: a frontend-only demo of ShareSpace backed by in-browser sample data.
 *
 * Only builds made with VITE_GUEST_MODE=true offer it (the GitHub Pages deployment, which has no
 * API server). With the flag off every helper here is inert and the app talks to the real API.
 * This module stays tiny; the sample data and request handlers load lazily from ./server.
 */

/** Build-time switch: whether this build offers "Explore with demo data". */
export const GUEST_MODE_ENABLED = import.meta.env.VITE_GUEST_MODE === 'true';

/** The demo account's user id. Never collides with real ids (those are cuids). */
export const GUEST_USER_ID = 'guest-user';

const STORAGE_KEY = 'sharespace.guest';

// Fallback for browsers that block sessionStorage: the session then lasts until the next reload.
let memoryFlag = false;

/** True while this tab is exploring as a guest. Survives reloads (sessionStorage), ends with the tab. */
export function isGuestActive(): boolean {
  if (!GUEST_MODE_ENABLED) return false;
  if (memoryFlag) return true;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function enterGuestMode(): void {
  if (!GUEST_MODE_ENABLED) return;
  memoryFlag = true;
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* storage unavailable: keep the in-memory flag */
  }
}

export function exitGuestMode(): void {
  memoryFlag = false;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- Receipt files ----------
// Sample receipts are served from in-browser object URLs, registered by the sample-data layer
// when it creates or uploads an attachment, so rendering code can look them up synchronously.

const attachmentUrls = new Map<string, string>();

export function registerGuestAttachment(id: string, url: string): void {
  attachmentUrls.set(id, url);
}

/** The local URL of a sample receipt, or null outside guest mode (use the API URL then). */
export function guestAttachmentUrl(id: string): string | null {
  return isGuestActive() ? (attachmentUrls.get(id) ?? null) : null;
}
