export const PRIORITY_COLORS = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
};

export const STATUS_COLORS = {
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  blocked: 'bg-orange-100 text-orange-800',
  skipped: 'bg-gray-100 text-gray-800',
  pending: 'bg-brand-100 text-brand-800',
  active: 'bg-green-100 text-green-800',
  draft: 'bg-gray-100 text-gray-800',
  deprecated: 'bg-red-100 text-red-800',
  in_progress: 'bg-brand-100 text-brand-800',
  completed: 'bg-green-100 text-green-800',
};

function parseDate(d) {
  if (!d) return null;
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" with no timezone — treat as UTC
  // ISO strings from nowISO() already end in "Z" and parse correctly
  const s = typeof d === 'string' && !d.endsWith('Z') && !d.includes('+') && !d.includes('T')
    ? d.replace(' ', 'T') + 'Z'
    : d;
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

export function fmtDate(d) {
  const dt = parseDate(d);
  if (!dt) return '—';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d) {
  const dt = parseDate(d);
  if (!dt) return '—';
  return dt.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function passRate(passed, total) {
  if (!total) return 0;
  return Math.round((passed / total) * 100);
}
