import { formatMoney } from '@sharespace/core';

export interface ReceiptSpec {
  merchant: string;
  address: string;
  date: string;
  currency: string;
  lines: { label: string; amountMinor: number }[];
  footer?: string;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Draws a plain till-style receipt as an SVG document (no external fonts or images). */
export function receiptSvg(spec: ReceiptSpec): string {
  const width = 320;
  const lineHeight = 22;
  const top = 118;
  const total = spec.lines.reduce((a, l) => a + l.amountMinor, 0);
  const rows = spec.lines
    .map(
      (l, i) =>
        `<text x="24" y="${top + i * lineHeight}">${escape(l.label)}</text>` +
        `<text x="${width - 24}" y="${top + i * lineHeight}" text-anchor="end">${escape(formatMoney(l.amountMinor, spec.currency))}</text>`,
    )
    .join('');
  const totalY = top + spec.lines.length * lineHeight + 18;
  const height = totalY + 70;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#FBF8F1"/>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#D9D2C3"/>`,
    `<g font-family="ui-monospace, Menlo, Consolas, monospace" font-size="13" fill="#2B2A26">`,
    `<text x="${width / 2}" y="40" text-anchor="middle" font-size="17" font-weight="700">${escape(spec.merchant)}</text>`,
    `<text x="${width / 2}" y="62" text-anchor="middle" fill="#6B675E">${escape(spec.address)}</text>`,
    `<text x="${width / 2}" y="82" text-anchor="middle" fill="#6B675E">${escape(spec.date)}</text>`,
    `<line x1="24" x2="${width - 24}" y1="96" y2="96" stroke="#B9B2A3" stroke-dasharray="4 3"/>`,
    rows,
    `<line x1="24" x2="${width - 24}" y1="${totalY - 18}" y2="${totalY - 18}" stroke="#B9B2A3" stroke-dasharray="4 3"/>`,
    `<text x="24" y="${totalY + 4}" font-weight="700">TOTAL</text>`,
    `<text x="${width - 24}" y="${totalY + 4}" text-anchor="end" font-weight="700">${escape(formatMoney(total, spec.currency))}</text>`,
    `<text x="${width / 2}" y="${totalY + 42}" text-anchor="middle" fill="#6B675E">${escape(spec.footer ?? 'Thank you! Visit again')}</text>`,
    `</g></svg>`,
  ].join('');
}

/** A URL the browser can display and open in a new tab (object URL; data URI as a fallback). */
export function svgUrl(svg: string): string {
  try {
    if (typeof URL.createObjectURL === 'function') return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  } catch {
    /* fall through */
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
