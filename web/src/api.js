const base = '';

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // resposta sem corpo JSON
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
  me: () => request('/api/me'),
  login: (username, password) =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/logout', { method: 'POST' }),
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
    request('/api/clients/location', {
      method: 'POST',
      body: JSON.stringify({ sessionKey, ...location }),
    }),
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
  topConsumers: (hours = 24, limit = 10) =>
    request(`/api/top-consumers?hours=${hours}&limit=${limit}`),
  sla: ({ days = 30, q = '', page = 1, pageSize = 15 } = {}) => {
    const params = new URLSearchParams({ days: String(days) });
    if (q) params.set('q', q);
    withPage(params, page, pageSize);
    return request(`/api/sla?${params}`);
  },
  slaByPort: (days = 30) => request(`/api/sla/by-port?days=${days}`),
  hourlyLoad: (days = 7) => {
    const tzOffsetMinutes = new Date().getTimezoneOffset();
    return request(`/api/hourly-load?days=${days}&tzOffsetMinutes=${tzOffsetMinutes}`);
  },
  anomalies: (hours = 168) => request(`/api/anomalies?hours=${hours}`),
  queueUsage: ({ hours = 24, page = 1, pageSize = 10 } = {}) => {
    const params = new URLSearchParams({ hours: String(hours) });
    withPage(params, page, pageSize);
    return request(`/api/queue-usage?${params}`);
  },
  clientDetail: (sessionKey) => request(`/api/client-detail?sessionKey=${encodeURIComponent(sessionKey)}`),
  mapPoints: () => request('/api/map'),
  exportDisconnectedUrl: (hours = 24) => `/api/export/disconnected.csv?hours=${hours}`,
  exportEventsUrl: (hours = 168, type = '') =>
    `/api/export/events.csv?hours=${hours}${type ? `&type=${type}` : ''}`,
  reportUrl: (days = 30) => `/api/report/monthly?days=${days}`,
};
