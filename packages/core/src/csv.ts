export type CsvValue = string | number | boolean | null | undefined;

/**
 * Escapes a CSV cell (RFC 4180) and neutralises spreadsheet formula injection:
 * text cells beginning with =, +, -, @, tab or carriage return are prefixed with an apostrophe.
 * Numbers are written as-is so negative amounts stay numeric.
 */
export function escapeCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}
