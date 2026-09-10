export function formatBps(bps) {
  if (bps == null) return '—';
  const n = Number(bps);
  if (n < 1000) return `${Math.round(n)} bps`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(0)} Kbps`;
  return `${(n / 1_000_000).toFixed(1)} Mbps`;
}

export function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function toDate(value) {
  if (!value) return null;
  const iso = value.endsWith('Z') || value.includes('+') ? value : `${value}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(value) : d;
}

export function formatDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString('pt-BR');
}

export function relativeAgo(value) {
  const d = toDate(value);
  if (!d) return '';
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function locationSummary(row) {
  const parts = [row.loc_neighborhood, row.loc_city].filter(Boolean);
  if (row.loc_region) return parts.length ? `${row.loc_region} · ${parts.join(', ')}` : row.loc_region;
  return parts.join(', ') || null;
}
