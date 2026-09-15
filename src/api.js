import { getServerUrl, getToken } from './storage';

async function request(path, options = {}) {
  const base = await getServerUrl();
  if (!base) {
    const err = new Error('Servidor não configurado');
    err.status = 0;
    throw err;
  }
  const token = await getToken();

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // sem corpo JSON
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

function withPage(params, page, pageSize) {
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return params;
}

export const api = {
  testConnection: async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  login: (username, password) =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/logout', { method: 'POST' }),
  me: () => request('/api/me'),
  dashboard: () => request('/api/dashboard'),
  status: () => request('/api/status'),
  online: ({ q = '', page = 1, pageSize = 20 } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    withPage(params, page, pageSize);
    return request(`/api/online?${params}`);
  },
  disconnected: ({ q = '', hours = 24, page = 1, pageSize = 20 } = {}) => {
    const params = new URLSearchParams({ hours: String(hours) });
    if (q) params.set('q', q);
    withPage(params, page, pageSize);
    return request(`/api/disconnected?${params}`);
  },
  all: ({ q = '', port = '', page = 1, pageSize = 20 } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (port) params.set('port', port);
    withPage(params, page, pageSize);
    return request(`/api/all?${params}`);
  },
  events: ({ q = '', type = '', hours = 168, page = 1, pageSize = 20 } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    params.set('hours', String(hours));
    withPage(params, page, pageSize);
    return request(`/api/events?${params}`);
  },
  setAlias: (sessionKey, alias) =>
    request('/api/clients/alias', { method: 'POST', body: JSON.stringify({ sessionKey, alias }) }),
  setLocation: (sessionKey, location) =>
    request('/api/clients/location', { method: 'POST', body: JSON.stringify({ sessionKey, ...location }) }),
  setPort: (sessionKey, port) =>
    request('/api/clients/port', { method: 'POST', body: JSON.stringify({ sessionKey, port }) }),
  removeClient: (sessionKey) =>
    request('/api/clients/remove', { method: 'POST', body: JSON.stringify({ sessionKey }) }),
  system: () => request('/api/system'),
  systemHistory: (hours = 24) => request(`/api/system/history?hours=${hours}`),
  interfaces: ({ page = 1, pageSize = 10 } = {}) => {
    const params = new URLSearchParams();
    withPage(params, page, pageSize);
    return request(`/api/interfaces?${params}`);
  },
  dhcpLeases: ({ q = '', page = 1, pageSize = 10 } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    withPage(params, page, pageSize);
    return request(`/api/dhcp-leases?${params}`);
  },
  queues: ({ page = 1, pageSize = 10 } = {}) => {
    const params = new URLSearchParams();
    withPage(params, page, pageSize);
    return request(`/api/queues?${params}`);
  },
  wireless: ({ page = 1, pageSize = 10 } = {}) => {
    const params = new URLSearchParams();
    withPage(params, page, pageSize);
    return request(`/api/wireless?${params}`);
  },
  logs: ({ q = '', topic = '', hours = 168, page = 1, pageSize = 20 } = {}) => {
    const params = new URLSearchParams({ hours: String(hours) });
    if (q) params.set('q', q);
    if (topic) params.set('topic', topic);
    withPage(params, page, pageSize);
    return request(`/api/logs?${params}`);
  },
  logTopics: () => request('/api/logs/topics'),
  bandwidthHistory: (client, hours = 24) =>
    request(`/api/bandwidth-history?client=${encodeURIComponent(client)}&hours=${hours}`),
  topConsumers: (hours = 24, limit = 10) => request(`/api/top-consumers?hours=${hours}&limit=${limit}`),
  sla: ({ days = 30, q = '', page = 1, pageSize = 15 } = {}) => {
    const params = new URLSearchParams({ days: String(days) });
    if (q) params.set('q', q);
    withPage(params, page, pageSize);
    return request(`/api/sla?${params}`);
  },
  slaByPort: (days = 30) => request(`/api/sla/by-port?days=${days}`),
  hourlyLoad: (days = 7, tzOffsetMinutes = 0) =>
    request(`/api/hourly-load?days=${days}&tzOffsetMinutes=${tzOffsetMinutes}`),
  anomalies: (hours = 168) => request(`/api/anomalies?hours=${hours}`),
  queueUsage: ({ hours = 24, page = 1, pageSize = 10 } = {}) => {
    const params = new URLSearchParams({ hours: String(hours) });
    withPage(params, page, pageSize);
    return request(`/api/queue-usage?${params}`);
  },
  clientDetail: (sessionKey) => request(`/api/client-detail?sessionKey=${encodeURIComponent(sessionKey)}`),
  registerPushToken: (token, platform) =>
    request('/api/push/register', { method: 'POST', body: JSON.stringify({ token, platform }) }),
  unregisterPushToken: (token) =>
    request('/api/push/unregister', { method: 'POST', body: JSON.stringify({ token }) }),
  testPushToken: (token) =>
    request('/api/push/test', { method: 'POST', body: JSON.stringify({ token }) }),
  notifications: ({ page = 1, pageSize = 20 } = {}) =>
    request(`/api/notifications?page=${page}&pageSize=${pageSize}`),
  listOlts: () => request('/api/olts'),
  createOlt: (name, portCount) =>
    request('/api/olts', { method: 'POST', body: JSON.stringify({ name, portCount }) }),
  deleteOlt: (id) => request(`/api/olts/${id}`, { method: 'DELETE' }),
  setClientOlt: (sessionKey, oltId) =>
    request('/api/clients/olt', { method: 'POST', body: JSON.stringify({ sessionKey, oltId: oltId || null }) }),
  portLabels: (oltId = 0) => request(`/api/port-labels?oltId=${oltId}`),
  setPortLabel: (oltId, port, label) =>
    request('/api/port-labels', { method: 'POST', body: JSON.stringify({ oltId: oltId || 0, port, label }) }),
  startPortCalibration: (port, oltId) =>
    request('/api/port-calibration/start', { method: 'POST', body: JSON.stringify({ port, oltId: oltId || null }) }),
  portCalibrationStatus: () => request('/api/port-calibration/status'),
  applyPortCalibration: () => request('/api/port-calibration/apply', { method: 'POST' }),
  cancelPortCalibration: () => request('/api/port-calibration/cancel', { method: 'POST' }),
  reportUrl: async (days = 30) => {
    const base = await getServerUrl();
    const token = await getToken();
    return `${base}/api/report/monthly?days=${days}&token=${encodeURIComponent(token || '')}`;
  },
};
