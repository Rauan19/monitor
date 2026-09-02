import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { api } from './api';
import Login from './Login';
import { disableWebPush, enableWebPush, isWebPushEnabled, isWebPushSupported } from './push';

const PAGE_SIZE = 20;

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`);
  if (Number.isNaN(d.getTime())) {
    return new Date(value).toLocaleString('pt-BR');
  }
  return d.toLocaleString('pt-BR');
}

function pageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push('…');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (current < total - 2) pages.push('…');
  pages.push(total);
  return pages;
}

function locationSummary(row) {
  const parts = [row.loc_neighborhood, row.loc_city].filter(Boolean);
  if (row.loc_region) return parts.length ? `${row.loc_region} · ${parts.join(', ')}` : row.loc_region;
  return parts.join(', ') || null;
}

function regionLabel(profile) {
  if (!profile) return null;
  const p = profile.toUpperCase();
  if (p.includes('RURAL')) return 'Rural';
  if (p.includes('CIDADE')) return 'Cidade';
  if (p.includes('CONPATILH') || p.includes('COMPARTILH')) return 'Compartilhado';
  return profile;
}

function formatBps(bps) {
  if (bps == null) return null;
  if (bps < 1000) return `${bps} bps`;
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(0)} Kbps`;
  return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}

function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function relativeAgo(value) {
  if (!value) return '';
  const d = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`);
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

const TABS = [
  { id: 'all', label: 'Todos', hint: 'Ativos e offline' },
  { id: 'online', label: 'Online', hint: 'Conectados agora' },
  { id: 'disconnected', label: 'Offline', hint: 'Últimas 24h' },
  { id: 'history', label: 'Histórico', hint: 'Eventos' },
  { id: 'map', label: 'Mapa', hint: 'Por localização' },
  { id: 'system', label: 'Sistema', hint: 'Saúde do CCR' },
  { id: 'stats', label: 'Estatísticas', hint: 'Gráficos e ranking' },
];

const LIST_TABS = new Set(['all', 'online', 'disconnected', 'history']);

const emptyMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, pages: 1 };

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  );
}

function IconOnline() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconDown() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v12" fill="none" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 12l5 5 5-5" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2.5" fill="none" strokeWidth="1.8" />
      <path d="M6 15H4.5A1.5 1.5 0 013 13.5v-9A1.5 1.5 0 014.5 3h9A1.5 1.5 0 0115 4.5V6" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyMac({ value }) {
  const [copied, setCopied] = useState(false);

  if (!value) return <span className="mono">—</span>;

  async function handleCopy(e) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement('textarea');
      el.value = value;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button type="button" className={`mac-copy ${copied ? 'copied' : ''}`} onClick={handleCopy} title="Copiar MAC">
      <span className="mono">{value}</span>
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

function IconDownArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v13M6 12l6 6 6-6" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconUpArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20V7M6 12l6-6 6 6" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="alert-dot">
      <circle cx="12" cy="12" r="9" fill="#fff" />
      <path d="M12 7.5v5.5" stroke="#7f1d1d" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.2" r="1.15" fill="#7f1d1d" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" strokeWidth="2" />
      <path d="M12 8v5l3 2" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconChevron({ dir = 'left' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={dir === 'right' ? 'flip' : ''}>
      <path d="M14.5 6L9 12l5.5 6" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 9a6 6 0 1112 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7z"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.5 19a2.5 2.5 0 005 0" fill="none" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 4H6a2 2 0 00-2 2v12a2 2 0 002 2h3M16 16l4-4-4-4M20 12H9"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconServer() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="6" rx="1.5" fill="none" strokeWidth="1.8" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" fill="none" strokeWidth="1.8" />
      <circle cx="7" cy="7" r="0.9" />
      <circle cx="7" cy="17" r="0.9" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20V10M11 20V4M18 20v-7" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 4L3 6.5v13L9 17l6 2.5L21 17V4l-6 2.5L9 4z"
        fill="none"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9 4v13M15 6.5v13" fill="none" strokeWidth="1.7" />
    </svg>
  );
}

const TAB_ICONS = {
  all: IconGrid,
  online: IconOnline,
  disconnected: IconDown,
  history: IconHistory,
  map: IconMap,
  system: IconServer,
  stats: IconChart,
};

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('all');
  const [dashboard, setDashboard] = useState(null);
  const [status, setStatus] = useState(null);
  const [allRows, setAllRows] = useState([]);
  const [online, setOnline] = useState([]);
  const [disconnected, setDisconnected] = useState([]);
  const [events, setEvents] = useState([]);
  const [allMeta, setAllMeta] = useState(emptyMeta);
  const [onlineMeta, setOnlineMeta] = useState(emptyMeta);
  const [disconnectedMeta, setDisconnectedMeta] = useState(emptyMeta);
  const [eventsMeta, setEventsMeta] = useState(emptyMeta);
  const [pageAll, setPageAll] = useState(1);
  const [pageOnline, setPageOnline] = useState(1);
  const [pageDisconnected, setPageDisconnected] = useState(1);
  const [pageHistory, setPageHistory] = useState(1);
  const [query, setQuery] = useState('');
  const [portFilter, setPortFilter] = useState('');
  const [eventType, setEventType] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [systemData, setSystemData] = useState(null);
  const [systemHistory, setSystemHistory] = useState([]);
  const [interfaces, setInterfaces] = useState([]);
  const [interfacesMeta, setInterfacesMeta] = useState(emptyMeta);
  const [interfacesPage, setInterfacesPage] = useState(1);
  const [dhcpLeases, setDhcpLeases] = useState([]);
  const [dhcpMeta, setDhcpMeta] = useState(emptyMeta);
  const [dhcpPage, setDhcpPage] = useState(1);
  const [dhcpQuery, setDhcpQuery] = useState('');
  const [queues, setQueues] = useState([]);
  const [queuesMeta, setQueuesMeta] = useState(emptyMeta);
  const [queuesPage, setQueuesPage] = useState(1);
  const [wireless, setWireless] = useState([]);
  const [wirelessMeta, setWirelessMeta] = useState(emptyMeta);
  const [wirelessPage, setWirelessPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [logsMeta, setLogsMeta] = useState(emptyMeta);
  const [logsPage, setLogsPage] = useState(1);
  const [logTopics, setLogTopics] = useState([]);
  const [logTopic, setLogTopic] = useState('');
  const [topConsumers, setTopConsumers] = useState([]);
  const [topLimit, setTopLimit] = useState(10);
  const [sla, setSla] = useState([]);
  const [slaMeta, setSlaMeta] = useState(emptyMeta);
  const [slaPage, setSlaPage] = useState(1);
  const [slaQuery, setSlaQuery] = useState('');
  const [slaByPort, setSlaByPort] = useState([]);
  const [hourlyLoad, setHourlyLoad] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [queueUsage, setQueueUsage] = useState([]);
  const [queueUsageMeta, setQueueUsageMeta] = useState(emptyMeta);
  const [queueUsagePage, setQueueUsagePage] = useState(1);
  const [statsError, setStatsError] = useState('');
  const [detailSessionKey, setDetailSessionKey] = useState(null);
  const [clientDetail, setClientDetail] = useState(null);
  const [clientDetailLoading, setClientDetailLoading] = useState(false);
  const [clientDetailError, setClientDetailError] = useState('');
  const [mapPoints, setMapPoints] = useState([]);
  const [mapError, setMapError] = useState('');
  const [pushEnabled, setPushEnabled] = useState(() => isWebPushEnabled());
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function metaOf(res) {
    return {
      page: res.page || 1,
      pageSize: res.pageSize || PAGE_SIZE,
      total: res.total || 0,
      pages: res.pages || 1,
    };
  }

  async function refresh() {
    try {
      const [dash, st, all, on, off, ev] = await Promise.all([
        api.dashboard(),
        api.status(),
        api.all({ q: query, port: portFilter, page: pageAll, pageSize: PAGE_SIZE }),
        api.online({ q: query, page: pageOnline, pageSize: PAGE_SIZE }),
        api.disconnected({ q: query, hours: 24, page: pageDisconnected, pageSize: PAGE_SIZE }),
        api.events({
          q: query,
          type: eventType,
          hours: 168,
          page: pageHistory,
          pageSize: PAGE_SIZE,
        }),
      ]);
      setDashboard(dash);
      setStatus(st);
      setAllRows(all.items || []);
      setOnline(on.items || []);
      setDisconnected(off.items || []);
      setEvents(ev.items || []);
      setAllMeta({
        page: all.page || 1,
        pageSize: all.pageSize || PAGE_SIZE,
        total: all.total || 0,
        pages: all.pages || 1,
      });
      setOnlineMeta({
        page: on.page || 1,
        pageSize: on.pageSize || PAGE_SIZE,
        total: on.total || 0,
        pages: on.pages || 1,
      });
      setDisconnectedMeta({
        page: off.page || 1,
        pageSize: off.pageSize || PAGE_SIZE,
        total: off.total || 0,
        pages: off.pages || 1,
      });
      setEventsMeta({
        page: ev.page || 1,
        pageSize: ev.pageSize || PAGE_SIZE,
        total: ev.total || 0,
        pages: ev.pages || 1,
      });
      if (all.page && all.page !== pageAll) setPageAll(all.page);
      if (on.page && on.page !== pageOnline) setPageOnline(on.page);
      if (off.page && off.page !== pageDisconnected) setPageDisconnected(off.page);
      if (ev.page && ev.page !== pageHistory) setPageHistory(ev.page);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        setUser(null);
        return;
      }
      setError(err.message || 'Falha ao carregar dados');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [user, query, portFilter, eventType, pageAll, pageOnline, pageDisconnected, pageHistory]);

  useEffect(() => {
    setPageAll(1);
    setPageOnline(1);
    setPageDisconnected(1);
    setPageHistory(1);
  }, [query, portFilter, eventType]);

  useEffect(() => {
    if (!user || tab !== 'system') return;
    let cancelled = false;
    async function load() {
      try {
        const [sys, hist, ifaces, dhcp, q, wl, lg] = await Promise.all([
          api.system(),
          api.systemHistory(24),
          api.interfaces({ page: interfacesPage, pageSize: 10 }),
          api.dhcpLeases({ q: dhcpQuery, page: dhcpPage, pageSize: 10 }),
          api.queues({ page: queuesPage, pageSize: 10 }),
          api.wireless({ page: wirelessPage, pageSize: 10 }),
          api.logs({ hours: 168, topic: logTopic, page: logsPage, pageSize: 15 }),
        ]);
        if (cancelled) return;
        setSystemData(sys);
        setSystemHistory(hist.items || []);
        setInterfaces(ifaces.items || []);
        setInterfacesMeta(metaOf(ifaces));
        setDhcpLeases(dhcp.items || []);
        setDhcpMeta(metaOf(dhcp));
        setQueues(q.items || []);
        setQueuesMeta(metaOf(q));
        setWireless(wl.items || []);
        setWirelessMeta(metaOf(wl));
        setLogs(lg.items || []);
        setLogsMeta(metaOf(lg));
        setStatsError('');
      } catch (err) {
        if (!cancelled) setStatsError(err.message || 'Falha ao carregar dados do sistema');
      }
    }
    load();
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, tab, interfacesPage, dhcpPage, dhcpQuery, queuesPage, wirelessPage, logsPage, logTopic]);

  useEffect(() => {
    if (!user || tab !== 'system') return;
    let cancelled = false;
    api
      .logTopics()
      .then((res) => {
        if (!cancelled) setLogTopics(res.items || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, tab]);

  const loadMapPoints = useCallback(async () => {
    try {
      const res = await api.mapPoints();
      setMapPoints(res.items || []);
      setMapError('');
    } catch (err) {
      setMapError(err.message || 'Falha ao carregar o mapa');
    }
  }, []);

  useEffect(() => {
    if (!user || tab !== 'map') return;
    loadMapPoints();
    const id = setInterval(loadMapPoints, 10000);
    return () => {
      clearInterval(id);
    };
  }, [user, tab]);

  useEffect(() => {
    if (!user || tab !== 'stats') return;
    let cancelled = false;
    async function load() {
      try {
        const [tc, slaData, hourly, anomaliesRes, queueUsageRes, slaPortRes] = await Promise.all([
          api.topConsumers(24, topLimit),
          api.sla({ days: 30, q: slaQuery, page: slaPage, pageSize: 15 }),
          api.hourlyLoad(7),
          api.anomalies(168),
          api.queueUsage({ hours: 24, page: queueUsagePage, pageSize: 10 }),
          api.slaByPort(30),
        ]);
        if (cancelled) return;
        setTopConsumers(tc.items || []);
        setSla(slaData.items || []);
        setSlaMeta(metaOf(slaData));
        setHourlyLoad(hourly.items || []);
        setAnomalies(anomaliesRes.items || []);
        setQueueUsage(queueUsageRes.items || []);
        setQueueUsageMeta(metaOf(queueUsageRes));
        setSlaByPort(slaPortRes.items || []);
        setStatsError('');
      } catch (err) {
        if (!cancelled) setStatsError(err.message || 'Falha ao carregar estatísticas');
      }
    }
    load();
    const id = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, tab, topLimit, slaQuery, slaPage, queueUsagePage]);

  useEffect(() => {
    setDhcpPage(1);
  }, [dhcpQuery]);

  useEffect(() => {
    setSlaPage(1);
  }, [slaQuery]);

  useEffect(() => {
    setLogsPage(1);
  }, [logTopic]);

  useEffect(() => {
    if (!detailSessionKey) {
      setClientDetail(null);
      setClientDetailError('');
      return;
    }
    let cancelled = false;
    setClientDetailLoading(true);
    setClientDetailError('');
    api
      .clientDetail(detailSessionKey)
      .then((data) => {
        if (!cancelled) setClientDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setClientDetailError(err.message || 'Falha ao carregar detalhes do cliente');
      })
      .finally(() => {
        if (!cancelled) setClientDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailSessionKey]);

  const openClientDetail = useCallback((sessionKey) => {
    setDetailSessionKey(sessionKey);
  }, []);

  function closeClientDetail() {
    setDetailSessionKey(null);
  }

  async function handleRename(sessionKey, alias) {
    await api.setAlias(sessionKey, alias);
    refresh();
  }

  async function handleSetLocation(sessionKey, location) {
    await api.setLocation(sessionKey, location);
    refresh();
  }

  async function handleSetPort(sessionKey, port) {
    await api.setPort(sessionKey, port);
    refresh();
  }

  async function handleRemove(sessionKey, displayName) {
    if (!window.confirm(`Remover ${displayName} da lista? Ele só volta a aparecer se reconectar.`)) {
      return;
    }
    try {
      await api.removeClient(sessionKey);
      refresh();
    } catch (err) {
      window.alert(err.message || 'Não foi possível remover');
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // segue mesmo se der erro
    }
    setUser(null);
  }

  async function handleTogglePush() {
    setPushBusy(true);
    setPushError('');
    try {
      if (pushEnabled) {
        await disableWebPush();
        setPushEnabled(false);
      } else {
        const res = await enableWebPush();
        if (res.ok) {
          setPushEnabled(true);
        } else {
          setPushError(res.error || 'Falha ao ativar notificações');
        }
      }
    } finally {
      setPushBusy(false);
    }
  }

  if (!authChecked) {
    return <div className="login-shell" />;
  }

  if (!user) {
    return <Login onSuccess={setUser} />;
  }

  const connected = Boolean(status?.connected ?? dashboard?.status?.connected);
  const lastError = status?.last_error || dashboard?.status?.last_error;

  const tabCount = {
    all: allMeta.total,
    online: onlineMeta.total,
    disconnected: disconnectedMeta.total,
    history: eventsMeta.total,
  };
  const isListTab = LIST_TABS.has(tab);

  const activeMeta =
    tab === 'all'
      ? allMeta
      : tab === 'online'
        ? onlineMeta
        : tab === 'disconnected'
          ? disconnectedMeta
          : eventsMeta;

  const activePage =
    tab === 'all'
      ? pageAll
      : tab === 'online'
        ? pageOnline
        : tab === 'disconnected'
          ? pageDisconnected
          : pageHistory;

  function setActivePage(next) {
    if (tab === 'all') setPageAll(next);
    else if (tab === 'online') setPageOnline(next);
    else if (tab === 'disconnected') setPageDisconnected(next);
    else setPageHistory(next);
  }

  const showSearch = isListTab;
  const currentTab = TABS.find((item) => item.id === tab);
  const canPaginate = !loading && activeMeta.total > PAGE_SIZE;

  return (
    <div className="shell">
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-menu-btn"
          aria-label="Abrir menu"
          onClick={() => setMobileMenuOpen(true)}
        >
          <IconMenu />
        </button>
        <span className="mobile-topbar-title">{currentTab?.label}</span>
        <span className={`mobile-topbar-dot ${connected ? 'ok' : 'bad'}`} aria-hidden="true" />
      </header>

      {mobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="brand-block">
          <h1>Monitor Zcnet</h1>
          <p>MikroTik PPPoE</p>
        </div>
        <button
          type="button"
          className="sidebar-close"
          aria-label="Fechar menu"
          onClick={() => setMobileMenuOpen(false)}
        >
          <IconClose />
        </button>

        <nav className="side-nav" aria-label="Seções">
          {TABS.map((item) => {
            const Icon = TAB_ICONS[item.id];
            return (
              <button
                key={item.id}
                type="button"
                className={`tab-${item.id} ${tab === item.id ? 'active' : ''}`}
                onClick={() => {
                  setTab(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                <span className="nav-icon">
                  <Icon />
                </span>
                <span className="nav-copy">
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
                <em>{tabCount[item.id]}</em>
              </button>
            );
          })}
        </nav>

        <div className={`side-status ${connected ? 'ok' : 'bad'}`}>
          <span className="dot" />
          <div>
            <strong>{connected ? 'API conectada' : 'API offline'}</strong>
            <span className="mono">{status ? (connected ? 'Sincronizando' : 'Sem resposta do CCR') : 'Aguardando'}</span>
          </div>
        </div>

        {isWebPushSupported() && (
          <button
            type="button"
            className={`push-btn ${pushEnabled ? 'active' : ''}`}
            onClick={handleTogglePush}
            disabled={pushBusy}
            title={pushError || undefined}
          >
            <IconBell />
            <span>{pushBusy ? 'Aguarde…' : pushEnabled ? 'Notificações ativas' : 'Ativar notificações'}</span>
          </button>
        )}
        {pushError && <span className="push-error">{pushError}</span>}

        <button type="button" className="logout-btn" onClick={handleLogout}>
          <IconLogout />
          <span>Sair ({user})</span>
        </button>
      </aside>

      <main className="main">
        <header className="main-head">
          <div>
            <h2>{currentTab?.label}</h2>
            <p>
              {currentTab?.hint} · só leitura · atualiza a cada {isListTab ? '5s' : '15s'}
            </p>
          </div>
        </header>

        <section className="metric-row" aria-label="Resumo">
          <article className="metric metric-ok">
            <span>Online</span>
            <strong>{dashboard?.online ?? 0}</strong>
          </article>
          <article className="metric metric-bad">
            <span>Offline 24h</span>
            <strong>{dashboard?.disconnected24h ?? 0}</strong>
          </article>
          <article className="metric metric-accent">
            <span>Voltou 24h</span>
            <strong>{dashboard?.connected24h ?? 0}</strong>
          </article>
          <article className="metric">
            <span>
              <i className="metric-live" aria-hidden="true" />
              Último poll
            </span>
            <strong>
              {relativeAgo(status?.last_success_at || status?.last_poll_at) || '—'}
            </strong>
          </article>
        </section>

        {(error || lastError) && (
          <div className="banner" role="alert">
            <strong>Sem leitura do CCR</strong>
            <span>{error || lastError}</span>
          </div>
        )}

        {showSearch && (
          <div className="toolbar">
            <input
              type="search"
              placeholder="Buscar nome, IP ou MAC"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              enterKeyHint="search"
            />
            {tab === 'history' && (
              <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="">Todos eventos</option>
                <option value="disconnected">Desconexões</option>
                <option value="connected">Conexões</option>
              </select>
            )}
            {tab === 'all' && (
              <select value={portFilter} onChange={(e) => setPortFilter(e.target.value)}>
                <option value="">Todas as portas</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
                  <option key={p} value={p}>
                    Porta {p}
                  </option>
                ))}
              </select>
            )}
            {tab === 'disconnected' && (
              <a className="export-btn" href={api.exportDisconnectedUrl(24)} target="_blank" rel="noreferrer">
                Exportar CSV
              </a>
            )}
            {tab === 'history' && (
              <a className="export-btn" href={api.exportEventsUrl(168, eventType)} target="_blank" rel="noreferrer">
                Exportar CSV
              </a>
            )}
          </div>
        )}

        <div className="stage">
          <section className="board" aria-live="polite">
            {loading ? (
              <div className="empty">
                <p>Carregando…</p>
              </div>
            ) : tab === 'all' ? (
              <ClientBoard
                rows={allRows}
                emptyTitle="Nenhum cliente ainda"
                emptyHint="Online e offline aparecem juntos aqui."
                mode="all"
                onRename={handleRename}
                onSetLocation={handleSetLocation}
                onSetPort={handleSetPort}
                onRemove={handleRemove}
                onOpenDetail={openClientDetail}
              />
            ) : tab === 'online' ? (
              <ClientBoard
                rows={online}
                emptyTitle="Ninguém online"
                emptyHint="Quando o CCR conectar, as sessões aparecem."
                mode="online"
                onRename={handleRename}
                onSetLocation={handleSetLocation}
                onSetPort={handleSetPort}
                onRemove={handleRemove}
                onOpenDetail={openClientDetail}
              />
            ) : tab === 'disconnected' ? (
              <ClientBoard
                rows={disconnected}
                emptyTitle="Nenhuma queda em 24h"
                emptyHint="Quem sair do PPPoE Active entra aqui."
                mode="disconnected"
                onRename={handleRename}
                onSetLocation={handleSetLocation}
                onSetPort={handleSetPort}
                onRemove={handleRemove}
                onOpenDetail={openClientDetail}
              />
            ) : tab === 'map' ? (
              <MapBoard
                points={mapPoints}
                error={mapError}
                onOpenDetail={openClientDetail}
                onRefresh={loadMapPoints}
              />
            ) : tab === 'system' ? (
              <SystemBoard
                data={systemData}
                history={systemHistory}
                interfaces={interfaces}
                interfacesMeta={interfacesMeta}
                interfacesPage={interfacesPage}
                onInterfacesPage={setInterfacesPage}
                dhcp={dhcpLeases}
                dhcpMeta={dhcpMeta}
                dhcpPage={dhcpPage}
                onDhcpPage={setDhcpPage}
                dhcpQuery={dhcpQuery}
                onDhcpQuery={setDhcpQuery}
                queues={queues}
                queuesMeta={queuesMeta}
                queuesPage={queuesPage}
                onQueuesPage={setQueuesPage}
                wireless={wireless}
                wirelessMeta={wirelessMeta}
                wirelessPage={wirelessPage}
                onWirelessPage={setWirelessPage}
                logs={logs}
                logsMeta={logsMeta}
                logsPage={logsPage}
                onLogsPage={setLogsPage}
                logTopics={logTopics}
                logTopic={logTopic}
                onLogTopic={setLogTopic}
                error={statsError}
              />
            ) : tab === 'stats' ? (
              <StatsBoard
                topConsumers={topConsumers}
                topLimit={topLimit}
                onTopLimit={setTopLimit}
                sla={sla}
                slaMeta={slaMeta}
                slaPage={slaPage}
                onSlaPage={setSlaPage}
                slaQuery={slaQuery}
                onSlaQuery={setSlaQuery}
                slaByPort={slaByPort}
                hourlyLoad={hourlyLoad}
                anomalies={anomalies}
                queueUsage={queueUsage}
                queueUsageMeta={queueUsageMeta}
                onQueueUsagePage={setQueueUsagePage}
                onOpenDetail={openClientDetail}
                error={statsError}
              />
            ) : (
              <EventBoard rows={events} />
            )}

            {isListTab && !loading && activeMeta.total > 0 && (
              <div className="page-meta">
                <button
                  type="button"
                  className="page-arrow"
                  disabled={!canPaginate || activePage <= 1}
                  onClick={() => setActivePage(activePage - 1)}
                  aria-label="Página anterior"
                >
                  <IconChevron dir="left" />
                </button>
                <div className="page-numbers">
                  {pageList(activePage, activeMeta.pages).map((p, idx) =>
                    p === '…' ? (
                      <span key={`ellipsis-${idx}`} className="page-ellipsis">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        className={p === activePage ? 'active' : ''}
                        onClick={() => setActivePage(p)}
                        disabled={!canPaginate}
                      >
                        {p}
                      </button>
                    )
                  )}
                </div>
                <button
                  type="button"
                  className="page-arrow"
                  disabled={!canPaginate || activePage >= activeMeta.pages}
                  onClick={() => setActivePage(activePage + 1)}
                  aria-label="Próxima página"
                >
                  <IconChevron dir="right" />
                </button>
                <span className="page-total">{activeMeta.total} itens</span>
              </div>
            )}
          </section>
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Navegação rápida mobile">
        {TABS.slice(0, 4).map((item) => {
          const Icon = TAB_ICONS[item.id];
          return (
            <button
              key={item.id}
              type="button"
              className={`tab-${item.id} ${tab === item.id && !mobileMenuOpen ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`mobile-nav-more ${mobileMenuOpen ? 'active' : ''}`}
          onClick={() => setMobileMenuOpen(true)}
        >
          <IconMore />
          <span>Mais</span>
        </button>
      </nav>

      {detailSessionKey && (
        <ClientDetailDrawer
          data={clientDetail}
          loading={clientDetailLoading}
          error={clientDetailError}
          onClose={closeClientDetail}
        />
      )}
    </div>
  );
}

function IconMore() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ClientDetailDrawer({ data, loading, error, onClose }) {
  const session = data?.session;
  const online = session ? Number(session.is_online) === 1 : false;
  const bwPoints = (data?.bandwidth || []).map((b) => ({ y: (b.down_bps || 0) + (b.up_bps || 0) }));
  const loc = session ? locationSummary(session) : null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>{session ? session.alias || session.name : 'Carregando…'}</h3>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </div>

        {loading && <p className="muted">Carregando detalhes…</p>}
        {error && (
          <div className="banner" role="alert">
            <strong>Erro</strong>
            <span>{error}</span>
          </div>
        )}

        {session && (
          <>
            <div className="drawer-badges">
              <span className={`badge ${online ? 'ok' : 'warn'}`}>{online ? 'Online' : 'Offline'}</span>
              {session.ont_port && <span className="port-badge">Porta {session.ont_port}</span>}
              {loc && <span className="region-tag">{loc}</span>}
            </div>

            <div className="sys-metrics drawer-metrics">
              <div>
                <span>IP</span>
                <strong className="mono">{session.address || '—'}</strong>
              </div>
              <div>
                <span>MAC</span>
                <strong className="mono">{session.caller_id || '—'}</strong>
              </div>
              <div>
                <span>Perfil</span>
                <strong>{session.profile || '—'}</strong>
              </div>
              <div>
                <span>Uptime PPP</span>
                <strong>{session.uptime || '—'}</strong>
              </div>
              {data?.sla && (
                <div>
                  <span>Uptime (30d)</span>
                  <strong>{data.sla.uptimePct}%</strong>
                </div>
              )}
              {data?.live && (
                <div>
                  <span>Velocidade agora</span>
                  <strong>
                    {formatBps(data.live.downBps || 0)} / {formatBps(data.live.upBps || 0)}
                  </strong>
                </div>
              )}
            </div>

            <h4>Banda (24h)</h4>
            <LineChart points={bwPoints} color="var(--cyan-ink)" />

            <h4>Eventos recentes</h4>
            {data?.events?.length ? (
              <ul className="log-list">
                {data.events.map((ev) => (
                  <li key={ev.id}>
                    <span className={`badge ${ev.event_type === 'disconnected' ? 'warn' : 'ok'}`}>
                      {ev.event_type === 'disconnected' ? 'Caiu' : 'Conectou'}
                    </span>
                    <span className="log-msg mono">{formatDate(ev.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Sem eventos registrados ainda.</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 20h4L18.5 9.5a1.5 1.5 0 000-2.12l-1.88-1.88a1.5 1.5 0 00-2.12 0L4 15v5z"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditableName({ row, onRename }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.alias || '');
  const [saving, setSaving] = useState(false);
  const displayName = row.alias || row.name || '—';

  async function save() {
    setSaving(true);
    try {
      await onRename(row.session_key, value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="name-edit" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          value={value}
          maxLength={80}
          placeholder={row.name}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <button type="button" onClick={save} disabled={saving}>
          {saving ? '…' : 'Ok'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="ghost">
          X
        </button>
      </div>
    );
  }

  return (
    <div className="row-title">
      <strong className="client-name" title={row.alias ? `${row.alias} (${row.name})` : row.name}>
        {displayName}
      </strong>
      {row.alias && <span className="mono alias-original">{row.name}</span>}
      <button
        type="button"
        className="edit-btn"
        aria-label="Editar apelido"
        onClick={(e) => {
          e.stopPropagation();
          setValue(row.alias || '');
          setEditing(true);
        }}
      >
        <IconEdit />
      </button>
    </div>
  );
}

function IconPin() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21s7-6.5 7-11a7 7 0 10-14 0c0 4.5 7 11 7 11z"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.2" fill="none" strokeWidth="1.8" />
    </svg>
  );
}

function IconGps() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" strokeWidth="1.8" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="8" fill="none" strokeWidth="1.8" />
    </svg>
  );
}

function LocationForm({ row, onSave, onCancel }) {
  const [form, setForm] = useState({
    region: row.loc_region || '',
    city: row.loc_city || '',
    street: row.loc_street || '',
    neighborhood: row.loc_neighborhood || '',
    lat: row.lat ?? null,
    lng: row.lng ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState('');

  function captureGps() {
    if (!navigator.geolocation) {
      setGpsError('Esse navegador não suporta GPS');
      return;
    }
    setLocating(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const label = row.alias || row.name || 'este cliente';
        const confirmed = window.confirm(
          `Confirma salvar a localização atual como o endereço de ${label}?`
        );
        if (!confirmed) return;
        const nextForm = { ...form, lat, lng };
        setForm(nextForm);
        setSaving(true);
        try {
          await onSave(nextForm);
        } finally {
          setSaving(false);
        }
      },
      (err) => {
        setGpsError(err.message || 'Não foi possível pegar a localização');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  const hasCoords = form.lat != null && form.lng != null;

  return (
    <div className="loc-editor" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        placeholder="Região"
        value={form.region}
        onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
        autoFocus
      />
      <input
        type="text"
        placeholder="Bairro (opcional)"
        value={form.neighborhood}
        onChange={(e) => setForm((f) => ({ ...f, neighborhood: e.target.value }))}
      />
      <input
        type="text"
        placeholder="Cidade (opcional)"
        value={form.city}
        onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
      />
      <input
        type="text"
        placeholder="Rua (opcional)"
        value={form.street}
        onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
      />
      <div className="loc-editor-gps">
        <button type="button" className="gps-btn" onClick={captureGps} disabled={locating}>
          <IconGps />
          {locating ? 'Pegando localização…' : hasCoords ? 'Atualizar localização (GPS)' : 'Marcar aqui (GPS)'}
        </button>
        {hasCoords && (
          <span className="mono gps-coords">
            {form.lat.toFixed(5)}, {form.lng.toFixed(5)}
          </span>
        )}
        {gpsError && <span className="gps-error">{gpsError}</span>}
      </div>
      <div className="loc-editor-actions">
        <button type="button" onClick={save} disabled={saving}>
          {saving ? '…' : 'Salvar'}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function PortTag({ row, onSetPort }) {
  const [saving, setSaving] = useState(false);

  async function handleChange(e) {
    const value = e.target.value;
    setSaving(true);
    try {
      await onSetPort(row.session_key, value ? Number(value) : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label
      className={`port-tag ${row.ont_port ? '' : 'is-unset'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <select value={row.ont_port || ''} onChange={handleChange} disabled={saving}>
        <option value="">Porta —</option>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
          <option key={p} value={p}>
            Porta {p}
          </option>
        ))}
      </select>
    </label>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0-.6 12.2a1.5 1.5 0 01-1.5 1.4H9.1a1.5 1.5 0 01-1.5-1.4L7 7h10z"
        fill="none"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClientBoard({ rows, emptyTitle, emptyHint, mode, onRename, onSetLocation, onSetPort, onRemove, onOpenDetail }) {
  const [editingLoc, setEditingLoc] = useState(null);

  if (!rows.length) {
    return (
      <div className="empty">
        <p>{emptyTitle}</p>
        <span>{emptyHint}</span>
      </div>
    );
  }

  return (
    <ul className="list-stack">
      {rows.map((row) => {
        const online = mode === 'online' ? true : Number(row.is_online) === 1;
        const key = row.session_key;

        const region = regionLabel(row.profile);
        const locSummary = locationSummary(row);
        const isEditingLoc = editingLoc === row.session_key;

        return (
          <li
            key={key}
            className={`row-card clickable ${online ? 'on' : 'off'}`}
            onClick={() => onOpenDetail?.(row.session_key)}
          >
            <div className="row-main">
              <span className={`badge ${online ? 'ok' : 'warn'}`}>
                {!online && <IconAlert />}
                {online ? 'Online' : 'Offline'}
              </span>
              <EditableName row={row} onRename={onRename} />
              <span className="mono row-ip">{row.address || 'sem IP'}</span>
              {region && <span className="region-tag">{region}</span>}
              <button
                type="button"
                className={`loc-tag ${locSummary ? '' : 'is-unset'} ${isEditingLoc ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingLoc(isEditingLoc ? null : row.session_key);
                }}
              >
                <IconPin />
                <span>{locSummary || 'Região'}</span>
              </button>
              <PortTag row={row} onSetPort={onSetPort} />
              {!online && (
                <button
                  type="button"
                  className="remove-btn"
                  aria-label="Remover cliente"
                  title="Remover da lista"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(row.session_key, row.alias || row.name);
                  }}
                >
                  <IconTrash />
                </button>
              )}
            </div>
            <div className="row-meta">
              <CopyMac value={row.caller_id} />
              {online && (row.downBps != null || row.upBps != null) && (
                <span className="speed-line mono">
                  <span className="speed-down">
                    <IconDownArrow />
                    {formatBps(row.downBps || 0)}
                  </span>
                  <span className="speed-up">
                    <IconUpArrow />
                    {formatBps(row.upBps || 0)}
                  </span>
                </span>
              )}
              <span>
                {online
                  ? row.uptime || relativeAgo(row.last_seen_at) || '—'
                  : relativeAgo(row.disconnected_at) || formatDate(row.disconnected_at)}
              </span>
            </div>
            {isEditingLoc && (
              <LocationForm
                row={row}
                onCancel={() => setEditingLoc(null)}
                onSave={async (form) => {
                  await onSetLocation(row.session_key, form);
                  setEditingLoc(null);
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LineChart({ points, color = 'var(--cyan-ink)', height = 70 }) {
  if (!points.length) return <div className="chart-empty">Sem dados ainda</div>;
  const width = 600;
  const values = points.map((p) => p.y);
  const max = Math.max(...values, 1);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p.y - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="line-chart">
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function CardHead({ title, count }) {
  return (
    <div className="sys-card-head">
      <h3>{title}</h3>
      {count != null && <span className="count-badge">{count}</span>}
    </div>
  );
}

function Pager({ meta, onChange }) {
  if (!meta || meta.total <= meta.pageSize) return null;
  return (
    <div className="page-meta small">
      <button
        type="button"
        className="page-arrow"
        disabled={meta.page <= 1}
        onClick={() => onChange(meta.page - 1)}
        aria-label="Página anterior"
      >
        <IconChevron dir="left" />
      </button>
      <div className="page-numbers">
        {pageList(meta.page, meta.pages).map((p, idx) =>
          p === '…' ? (
            <span key={`e-${idx}`} className="page-ellipsis">
              …
            </span>
          ) : (
            <button key={p} type="button" className={p === meta.page ? 'active' : ''} onClick={() => onChange(p)}>
              {p}
            </button>
          )
        )}
      </div>
      <button
        type="button"
        className="page-arrow"
        disabled={meta.page >= meta.pages}
        onClick={() => onChange(meta.page + 1)}
        aria-label="Próxima página"
      >
        <IconChevron dir="right" />
      </button>
      <span className="page-total">{meta.total} itens</span>
    </div>
  );
}

function SystemBoard({
  data,
  history,
  interfaces,
  interfacesMeta,
  interfacesPage,
  onInterfacesPage,
  dhcp,
  dhcpMeta,
  dhcpPage,
  onDhcpPage,
  dhcpQuery,
  onDhcpQuery,
  queues,
  queuesMeta,
  queuesPage,
  onQueuesPage,
  wireless,
  wirelessMeta,
  wirelessPage,
  onWirelessPage,
  logs,
  logsMeta,
  logsPage,
  onLogsPage,
  logTopics,
  logTopic,
  onLogTopic,
  error,
}) {
  const resource = data?.resource;
  const health = data?.health || {};
  const cpuPoints = history.map((h) => ({ y: h.cpu_load ?? 0 }));
  const memPoints = history.map((h) => {
    const used = h.total_memory != null && h.free_memory != null ? h.total_memory - h.free_memory : 0;
    return { y: used };
  });

  return (
    <div className="sys-grid">
      {error && (
        <div className="banner" role="alert">
          <strong>Erro</strong>
          <span>{error}</span>
        </div>
      )}

      <section className="sys-card">
        <CardHead title="Recursos do CCR" />
        {resource ? (
          <div className="sys-metrics">
            <div>
              <span>CPU</span>
              <strong>{resource.cpuLoad ?? '—'}%</strong>
            </div>
            <div>
              <span>Memória livre</span>
              <strong>{formatBytes(resource.freeMemory)}</strong>
            </div>
            <div>
              <span>Memória total</span>
              <strong>{formatBytes(resource.totalMemory)}</strong>
            </div>
            <div>
              <span>Uptime</span>
              <strong>{resource.uptime || '—'}</strong>
            </div>
            <div>
              <span>Versão</span>
              <strong>{resource.version || '—'}</strong>
            </div>
            <div>
              <span>Placa</span>
              <strong>{resource.boardName || '—'}</strong>
            </div>
            {health.voltage != null && (
              <div>
                <span>Voltagem</span>
                <strong>{health.voltage}V</strong>
              </div>
            )}
            {health.temperature != null && (
              <div>
                <span>Temperatura</span>
                <strong>{health.temperature}°C</strong>
              </div>
            )}
          </div>
        ) : (
          <p className="muted">Carregando…</p>
        )}
      </section>

      <section className="sys-card">
        <CardHead title="CPU (24h)" />
        <LineChart points={cpuPoints} color="var(--cyan-ink)" />
      </section>

      <section className="sys-card">
        <CardHead title="Memória usada (24h)" />
        <LineChart points={memPoints} color="var(--violet-ink)" />
      </section>

      <section className="sys-card wide">
        <CardHead title="Interfaces" count={interfacesMeta?.total} />
        {interfaces.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Drops</th>
                    <th>Erros</th>
                    <th>Link down</th>
                  </tr>
                </thead>
                <tbody>
                  {interfaces.map((r) => (
                    <tr key={r.name}>
                      <td className="mono name-strong">{r.name}</td>
                      <td>{r.type || '—'}</td>
                      <td>
                        <span className={`badge ${r.running ? 'ok' : 'warn'}`}>
                          {r.disabled ? 'Desligada' : r.running ? 'Ativa' : 'Inativa'}
                        </span>
                      </td>
                      <td>{r.rxDrop + r.txDrop}</td>
                      <td>{r.rxError + r.txError}</td>
                      <td>{r.linkDowns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager meta={interfacesMeta} onChange={onInterfacesPage} />
          </>
        ) : (
          <p className="muted">Sem dados ainda.</p>
        )}
      </section>

      {wireless.length > 0 && (
        <section className="sys-card wide">
          <CardHead title="Clientes wireless" count={wirelessMeta?.total} />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>MAC</th>
                  <th>Sinal</th>
                  <th>CCQ TX</th>
                  <th>CCQ RX</th>
                  <th>Uptime</th>
                </tr>
              </thead>
              <tbody>
                {wireless.map((r, i) => (
                  <tr key={i}>
                    <td className="name-strong">{r.interface}</td>
                    <td className="mono">{r.mac}</td>
                    <td>{r.signal}</td>
                    <td>{r.txCcq}</td>
                    <td>{r.rxCcq}</td>
                    <td>{r.uptime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={wirelessMeta} onChange={onWirelessPage} />
        </section>
      )}

      <section className="sys-card wide">
        <CardHead title="Leases DHCP" count={dhcpMeta?.total} />
        <div className="mini-toolbar">
          <input
            type="search"
            placeholder="Buscar IP, MAC ou host"
            value={dhcpQuery}
            onChange={(e) => onDhcpQuery(e.target.value)}
          />
        </div>
        {dhcp.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>IP</th>
                    <th>MAC</th>
                    <th>Host</th>
                    <th>Status</th>
                    <th>Expira</th>
                  </tr>
                </thead>
                <tbody>
                  {dhcp.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.address}</td>
                      <td className="mono">{r.mac}</td>
                      <td className="name-strong">{r.hostname || '—'}</td>
                      <td>{r.status}</td>
                      <td>{r.expiresAfter || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager meta={dhcpMeta} onChange={onDhcpPage} />
          </>
        ) : (
          <p className="muted">Nada encontrado.</p>
        )}
      </section>

      {queues.length > 0 && (
        <section className="sys-card wide">
          <CardHead title="Filas (limite contratado)" count={queuesMeta?.total} />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Alvo</th>
                  <th>Limite máx.</th>
                  <th>Taxa atual</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((r, i) => (
                  <tr key={i}>
                    <td className="name-strong">{r.name}</td>
                    <td className="mono">{r.target}</td>
                    <td className="mono">{r.maxLimit}</td>
                    <td className="mono">{r.rate || '—'}</td>
                    <td>
                      <span className={`badge ${r.disabled ? 'warn' : 'ok'}`}>
                        {r.disabled ? 'Desativada' : 'Ativa'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={queuesMeta} onChange={onQueuesPage} />
        </section>
      )}

      <section className="sys-card wide">
        <CardHead title="Log do CCR" count={logsMeta?.total} />
        <div className="mini-toolbar">
          <select value={logTopic} onChange={(e) => onLogTopic(e.target.value)}>
            <option value="">Todos os tópicos</option>
            {(logTopics || []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {logs.length ? (
          <>
            <ul className="log-list">
              {logs.map((r) => (
                <li key={r.id}>
                  <span className="mono log-time">{formatDate(r.fetched_at)}</span>
                  {r.topics && <span className="log-topic">{r.topics}</span>}
                  <span className="log-msg">{r.message}</span>
                </li>
              ))}
            </ul>
            <Pager meta={logsMeta} onChange={onLogsPage} />
          </>
        ) : (
          <p className="muted">Sem entradas de log ainda.</p>
        )}
      </section>
    </div>
  );
}

function HourlyBarChart({ data }) {
  if (!data.length) return <div className="chart-empty">Sem dados ainda</div>;
  const max = Math.max(...data.map((d) => d.avgDownBps + d.avgUpBps), 1);
  return (
    <div className="bar-chart">
      {data.map((d) => {
        const total = d.avgDownBps + d.avgUpBps;
        const pct = Math.max(2, Math.round((total / max) * 100));
        return (
          <div key={d.hour} className="bar-col" title={`${String(d.hour).padStart(2, '0')}h — ${formatBps(Math.round(total))}`}>
            <div className="bar" style={{ height: `${pct}%` }} />
            <span>{d.hour % 3 === 0 ? String(d.hour).padStart(2, '0') : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function StatsBoard({
  topConsumers,
  topLimit,
  onTopLimit,
  sla,
  slaMeta,
  slaPage,
  onSlaPage,
  slaQuery,
  onSlaQuery,
  slaByPort,
  hourlyLoad,
  anomalies,
  queueUsage,
  queueUsageMeta,
  onQueueUsagePage,
  onOpenDetail,
  error,
}) {
  return (
    <div className="sys-grid">
      {error && (
        <div className="banner" role="alert">
          <strong>Erro</strong>
          <span>{error}</span>
        </div>
      )}

      <section className="sys-card wide">
        <div className="sys-card-head">
          <h3>Relatório mensal</h3>
        </div>
        <p className="muted">Resumo de uptime, consumo e quedas dos últimos 30 dias, pronto pra imprimir ou salvar em PDF.</p>
        <a className="export-btn" href={api.reportUrl(30)} target="_blank" rel="noreferrer">
          Abrir relatório
        </a>
      </section>

      {anomalies.length > 0 && (
        <section className="sys-card wide">
          <CardHead title="Uso fora do padrão agora" count={anomalies.length} />
          <p className="muted">Clientes usando bem mais banda do que a própria média histórica sugere.</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Agora</th>
                  <th>Média histórica</th>
                  <th>Direção</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a, i) => (
                  <tr key={i}>
                    <td className="mono name-strong">{a.name}</td>
                    <td>
                      {formatBps(a.currentDownBps)} ↓ / {formatBps(a.currentUpBps)} ↑
                    </td>
                    <td>
                      {formatBps(a.avgDownBps)} ↓ / {formatBps(a.avgUpBps)} ↑
                    </td>
                    <td>
                      <span className="badge warn">{a.direction}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="sys-card wide">
        <CardHead title="Horário de pico (7 dias)" />
        <HourlyBarChart data={hourlyLoad} />
      </section>

      <section className="sys-card wide">
        <CardHead title="Uptime médio por porta/OLT" />
        {slaByPort.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Porta</th>
                  <th>Clientes</th>
                  <th>Uptime médio</th>
                  <th>Tempo offline médio</th>
                </tr>
              </thead>
              <tbody>
                {slaByPort.map((p, i) => (
                  <tr key={i}>
                    <td className="name-strong">{p.port === 'sem-porta' ? 'Sem porta definida' : `Porta ${p.port}`}</td>
                    <td>{p.clients}</td>
                    <td>{p.avgUptimePct}%</td>
                    <td>{p.avgDowntimeMinutes} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Sem dados suficientes ainda.</p>
        )}
      </section>

      {queueUsage.length > 0 && (
        <section className="sys-card wide">
          <CardHead title="Fila x consumo real" count={queueUsageMeta?.total} />
          <p className="muted">Compara o limite contratado na fila com a média real de uso — útil pra achar quem paga por banda que não usa ou quem já saturou o plano.</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Limite (down/up)</th>
                  <th>Uso médio (down/up)</th>
                  <th>% do limite</th>
                </tr>
              </thead>
              <tbody>
                {queueUsage.map((q, i) => (
                  <tr key={i}>
                    <td className="mono name-strong">{q.client}</td>
                    <td className="mono">
                      {formatBps(q.downloadLimitBps)} / {formatBps(q.uploadLimitBps)}
                    </td>
                    <td className="mono">
                      {formatBps(Math.round(q.avgDownBps || 0))} / {formatBps(Math.round(q.avgUpBps || 0))}
                    </td>
                    <td>
                      {q.downloadUsagePct != null ? (
                        <span className={`badge ${q.downloadUsagePct > 90 ? 'warn' : 'ok'}`}>{q.downloadUsagePct}%</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={queueUsageMeta} onChange={onQueueUsagePage} />
        </section>
      )}

      <section className="sys-card wide">
        <CardHead title="Top consumo de banda (24h, média)" />
        <div className="mini-toolbar">
          <select value={topLimit} onChange={(e) => onTopLimit(Number(e.target.value))}>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
          </select>
        </div>
        {topConsumers.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Download médio</th>
                  <th>Upload médio</th>
                  <th>Pico download</th>
                </tr>
              </thead>
              <tbody>
                {topConsumers.map((c, i) => (
                  <tr key={i}>
                    <td className="mono name-strong">{c.name}</td>
                    <td>{formatBps(Math.round(c.avgDownBps || 0))}</td>
                    <td>{formatBps(Math.round(c.avgUpBps || 0))}</td>
                    <td>{formatBps(Math.round(c.peakDownBps || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Ainda sem amostras suficientes — aguarde o poller coletar histórico.</p>
        )}
      </section>

      <section className="sys-card wide">
        <CardHead title="Uptime por cliente (30 dias, estimado)" count={slaMeta?.total} />
        <div className="mini-toolbar">
          <input
            type="search"
            placeholder="Buscar cliente"
            value={slaQuery}
            onChange={(e) => onSlaQuery(e.target.value)}
          />
        </div>
        {sla.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Uptime</th>
                    <th>Tempo offline</th>
                  </tr>
                </thead>
                <tbody>
                  {sla.map((s) => (
                    <tr key={s.sessionKey} className="clickable-row" onClick={() => onOpenDetail?.(s.sessionKey)}>
                      <td className="mono name-strong">{s.name}</td>
                      <td>{s.uptimePct}%</td>
                      <td>{s.downtimeMinutes} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager meta={slaMeta} onChange={onSlaPage} />
          </>
        ) : (
          <p className="muted">Nada encontrado.</p>
        )}
      </section>
    </div>
  );
}

const PIN_ONLINE = '#17a56b';
const PIN_OFFLINE = '#dc2626';

function buildPinIcon(online) {
  const color = online ? PIN_ONLINE : PIN_OFFLINE;
  const ring = !online ? `<circle class="pin-ping" cx="18" cy="16" r="10" fill="${color}"/>` : '';
  const html = `
    <svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      <defs>
        <filter id="pin-shadow-${online ? 'on' : 'off'}" x="-50%" y="-30%" width="200%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#14161a" flood-opacity="0.35"/>
        </filter>
      </defs>
      ${ring}
      <g filter="url(#pin-shadow-${online ? 'on' : 'off'})">
        <path
          d="M18 3C11.1 3 5.5 8.6 5.5 15.5c0 9.6 12.5 26.4 12.5 26.4s12.5-16.8 12.5-26.4C30.5 8.6 24.9 3 18 3z"
          fill="${color}"
          stroke="#ffffff"
          stroke-width="2"
        />
        <circle cx="18" cy="15.5" r="5.4" fill="#ffffff"/>
      </g>
    </svg>
  `;
  return L.divIcon({
    html,
    className: 'client-pin',
    iconSize: [36, 46],
    iconAnchor: [18, 42],
    popupAnchor: [0, -38],
  });
}

function buildClusterIcon(cluster) {
  const markers = cluster.getAllChildMarkers();
  const count = markers.length;
  const hasOffline = markers.some((m) => m.options.clientOnline === false);
  const color = hasOffline ? PIN_OFFLINE : PIN_ONLINE;
  const size = count < 10 ? 34 : count < 50 ? 42 : 50;
  const html = `<div class="cluster-badge" style="width:${size}px;height:${size}px;background:${color};"><span>${count}</span></div>`;
  return L.divIcon({ html, className: 'client-cluster', iconSize: [size, size] });
}

function IconLayers() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3l9 5-9 5-9-5 9-5z"
        fill="none"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M3 13l9 5 9-5" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCrosshair() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path
        d="M12 2v5M12 17v5M2 12h5M17 12h5"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="7.5" fill="none" strokeWidth="1.8" />
    </svg>
  );
}

function IconRoute() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="6" r="2.2" fill="none" strokeWidth="1.8" />
      <circle cx="19" cy="18" r="2.2" fill="none" strokeWidth="1.8" />
      <path
        d="M6.8 7.4C9 9 6 12 9 13.6c3 1.6 6-1.5 8.2 0.2"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="2.5 2.5"
      />
    </svg>
  );
}

function ClientPicker({ latlng, onPick, onCancel }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await api.all({ q, page: 1, pageSize: 6 });
        if (!cancelled) setResults(res.items || []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q]);

  async function handlePick(row) {
    const label = row.alias || row.name || 'este cliente';
    if (!window.confirm(`Confirma marcar esse ponto do mapa como o endereço de ${label}?`)) return;
    setSaving(true);
    try {
      await onPick(row);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pin-picker" onClick={(e) => e.stopPropagation()}>
      <div className="pin-picker-head">
        <strong>Marcar cliente aqui</strong>
        <span className="mono">
          {latlng.lat.toFixed(5)}, {latlng.lng.toFixed(5)}
        </span>
      </div>
      <input
        type="text"
        placeholder="Buscar nome do cliente…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      {loading && <p className="muted">Buscando…</p>}
      {!loading && q.trim() && results.length === 0 && <p className="muted">Nada encontrado.</p>}
      <ul className="pin-picker-results">
        {results.map((r) => (
          <li key={r.session_key}>
            <button type="button" disabled={saving} onClick={() => handlePick(r)}>
              <span className="client-name">{r.alias || r.name}</span>
              <span className="mono">{r.address || 'sem IP'}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="pin-picker-actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

const BASEMAPS = {
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Tiles &copy; Esri — Earthstar Geographics' },
  },
};

function MapBoard({ points, error, onOpenDetail, onRefresh }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const clusterRef = useRef(null);
  const tileLayerRef = useRef(null);
  const firstFitRef = useRef(false);
  const pickingRef = useRef(false);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [pendingLatLng, setPendingLatLng] = useState(null);
  const [basemap, setBasemap] = useState('streets');

  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);

  const filtered = points.filter((p) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return [p.name, p.alias, p.loc_region, p.loc_neighborhood, p.loc_city, p.ont_port ? `porta ${p.ont_port}` : '']
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [-13.0, -38.9],
      zoom: 12,
      maxZoom: 19,
      zoomControl: true,
    });

    const cluster = L.markerClusterGroup({
      iconCreateFunction: buildClusterIcon,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 55,
    });
    map.addLayer(cluster);
    clusterRef.current = cluster;

    map.on('click', (e) => {
      if (!pickingRef.current) return;
      setPendingLatLng({ lat: e.latlng.lat, lng: e.latlng.lng });
      setPicking(false);
    });

    mapRef.current = map;

    // o container nasce dentro de um flexbox que ainda não terminou de calcular o
    // tamanho quando o Leaflet mede a área pela primeira vez — sem isso, o mapa
    // fica "preso" com poucos pixels de largura e não carrega os tiles direito.
    requestAnimationFrame(() => map.invalidateSize());
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      tileLayerRef.current = null;
      firstFitRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    const def = BASEMAPS[basemap];
    tileLayerRef.current = L.tileLayer(def.url, def.options).addTo(map);
  }, [basemap]);

  useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;

    cluster.clearLayers();
    const markers = [];

    for (const p of filtered) {
      if (p.lat == null || p.lng == null) continue;
      const online = Number(p.is_online) === 1;
      const label = p.alias || p.name || 'Cliente';
      const parts = [p.loc_neighborhood, p.loc_city].filter(Boolean).join(', ');
      const popupHtml = `
        <strong>${label}</strong><br/>${online ? 'Online' : 'Offline'}${
        p.ont_port ? ` · Porta ${p.ont_port}` : ''
      }${parts ? `<br/>${parts}` : ''}
        <br/><a class="popup-route" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noreferrer">Abrir rota →</a>
      `;

      const marker = L.marker([p.lat, p.lng], {
        icon: buildPinIcon(online),
        clientOnline: online,
      });
      marker.bindPopup(popupHtml);
      marker.on('click', () => onOpenDetail?.(p.session_key));
      markers.push(marker);
    }

    cluster.addLayers(markers);

    if (!firstFitRef.current && markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => m.getLatLng()));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      firstFitRef.current = true;
    }
  }, [filtered, onOpenDetail]);

  async function handlePickClient(row) {
    if (!pendingLatLng) return;
    await api.setLocation(row.session_key, {
      region: row.loc_region,
      city: row.loc_city,
      street: row.loc_street,
      neighborhood: row.loc_neighborhood,
      lat: pendingLatLng.lat,
      lng: pendingLatLng.lng,
    });
    setPendingLatLng(null);
    onRefresh?.();
  }

  return (
    <div className="map-board">
      {error && (
        <div className="banner" role="alert">
          <strong>Erro</strong>
          <span>{error}</span>
        </div>
      )}
      <div className="map-toolbar">
        <input
          type="search"
          placeholder="Buscar no mapa (nome, região, porta)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="pick-btn"
          onClick={() => setBasemap((b) => (b === 'streets' ? 'satellite' : 'streets'))}
        >
          <IconLayers />
          {basemap === 'streets' ? 'Satélite' : 'Ruas'}
        </button>
        <button
          type="button"
          className={`pick-btn ${picking ? 'active' : ''}`}
          onClick={() => setPicking((v) => !v)}
        >
          <IconCrosshair />
          {picking ? 'Clique no mapa…' : 'Marcar clicando no mapa'}
        </button>
      </div>
      {!error && points.length === 0 && (
        <div className="empty map-empty">
          <p>Nenhum cliente com localização marcada</p>
          <span>
            Use o GPS no card do cliente (tag "Região" → "Marcar aqui") ou clique em "Marcar clicando no
            mapa" aqui em cima.
          </span>
        </div>
      )}
      <div className="map-legend">
        <span>
          <i className="dot-legend ok" /> Online
        </span>
        <span>
          <i className="dot-legend bad" /> Offline
        </span>
        <span className="map-count">
          {filtered.length}
          {query.trim() ? ` de ${points.length}` : ''} marcados
        </span>
      </div>
      <div className={`map-container ${basemap} ${picking ? 'picking' : ''}`} ref={containerRef} />
      {pendingLatLng && (
        <ClientPicker
          latlng={pendingLatLng}
          onPick={handlePickClient}
          onCancel={() => setPendingLatLng(null)}
        />
      )}
    </div>
  );
}

function EventBoard({ rows }) {
  if (!rows.length) {
    return (
      <div className="empty">
        <p>Nenhum evento no período</p>
        <span>Conexões e desconexões ficam aqui.</span>
      </div>
    );
  }

  return (
    <ul className="list-stack">
      {rows.map((row) => {
        const down = row.event_type === 'disconnected';
        return (
          <li key={row.id} className={`row-card ${down ? 'off' : 'on'}`}>
            <div className="row-main">
              <span className={`badge ${down ? 'warn' : 'ok'}`}>
                {down ? 'Desconectou' : 'Conectou'}
              </span>
              <div className="row-title">
                <strong className="client-name" title={row.name}>
                  {row.name || '—'}
                </strong>
                <span className="mono">{row.address || 'sem IP'}</span>
              </div>
            </div>
            <div className="row-meta">
              <CopyMac value={row.caller_id} />
              <span>{formatDate(row.created_at)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
