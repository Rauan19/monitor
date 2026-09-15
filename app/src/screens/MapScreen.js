import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { colors, radius } from '../theme';
import { api } from '../api';
import { withCache } from '../cache';
import { ErrorBanner, LoadingState, SearchBar, StaleBanner } from '../components/common';

// Leaflet com tiles de OpenStreetMap e Esri, dentro de um WebView.
//
// Por que nao react-native-maps / expo-maps: os dois usam o SDK nativo do
// Google Maps no Android, que exige chave de API configurada no Google Cloud
// e faturamento habilitado. Sem chave o mapa renderiza cinza. Aqui reusamos
// exatamente o que o painel web ja usa (Leaflet + OSM + Esri), sem chave
// nenhuma e com o mesmo visual dos dois lados.
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist';

const ONLINE = '#34d399';
const OFFLINE = '#f87171';

function montarHtml(pontos, oltsPorId) {
  // Os dados vao serializados dentro do HTML em vez de postMessage pra o mapa
  // ja nascer pronto: com postMessage o usuario veria o mapa vazio por um
  // instante antes dos pontos aparecerem.
  // O nome da OLT e resolvido aqui, no lado do app, e ja vai pronto pro HTML:
  // o WebView nao tem como consultar a API.
  const comOlt = pontos.map((p) => ({
    ...p,
    olt_nome: p.olt_id ? oltsPorId?.[Number(p.olt_id)] || null : null,
  }));
  const dados = JSON.stringify(comOlt).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="${LEAFLET}/leaflet.css" />
  <style>
    html, body, #mapa { height: 100%; margin: 0; background: ${colors.bg}; }
    .leaflet-container { background: ${colors.bg}; }
    .pino {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid rgba(0,0,0,0.55); box-sizing: border-box;
    }
    .grupo {
      background: rgba(91,141,239,0.9); color: #fff; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font: 700 12px -apple-system, Roboto, sans-serif;
      border: 2px solid rgba(255,255,255,0.35);
    }
    .leaflet-popup-content-wrapper {
      background: ${colors.surface}; color: ${colors.ink};
      border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);
    }
    .leaflet-popup-tip { background: ${colors.surface}; }
    .leaflet-popup-content { margin: 10px 12px; padding-right: 14px; font: 13px -apple-system, Roboto, sans-serif; }
    .leaflet-popup-close-button { color: ${colors.inkSoft} !important; }
    .pnome { font-weight: 800; margin-bottom: 3px; }
    .pmeta { color: ${colors.inkSoft}; font-size: 11.5px; }
    .pbtn {
      display: inline-block; margin-top: 8px; padding: 6px 10px;
      background: ${colors.accent}; color: #061024; border-radius: 8px;
      font-weight: 800; font-size: 11.5px; text-decoration: none;
    }
    .attr { font-size: 9px; }
  </style>
</head>
<body>
  <div id="mapa"></div>
  <script src="${LEAFLET}/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
  <script>
    var pontos = ${dados};
    var mapa = L.map('mapa', { zoomControl: false, attributionControl: true });
    L.control.zoom({ position: 'bottomright' }).addTo(mapa);

    var ruas = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap', className: 'tiles-ruas'
    });
    var satelite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Tiles &copy; Esri, Earthstar Geographics' }
    );
    ruas.addTo(mapa);
    L.control.layers({ 'Ruas': ruas, 'Satelite': satelite }, null, { position: 'topright' }).addTo(mapa);

    var grupo = L.markerClusterGroup({
      maxClusterRadius: 45,
      iconCreateFunction: function (c) {
        var n = c.getChildCount();
        var t = n < 10 ? 32 : n < 100 ? 38 : 44;
        return L.divIcon({
          html: '<div class="grupo" style="width:' + t + 'px;height:' + t + 'px">' + n + '</div>',
          className: '', iconSize: [t, t]
        });
      }
    });

    pontos.forEach(function (p) {
      if (p.lat == null || p.lng == null) return;
      var cor = p.is_online ? '${ONLINE}' : '${OFFLINE}';
      var m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          html: '<div class="pino" style="background:' + cor + '"></div>',
          className: '', iconSize: [14, 14], iconAnchor: [7, 7]
        })
      });
      var nome = p.alias || p.name || 'cliente';
      var meta = [];
      if (p.olt_nome) meta.push('OLT ' + p.olt_nome);
      if (p.ont_port) meta.push('Porta ' + p.ont_port);
      if (p.loc_neighborhood) meta.push(p.loc_neighborhood);
      if (p.loc_city) meta.push(p.loc_city);
      m.bindPopup(
        '<div class="pnome">' + nome + '</div>' +
        '<div class="pmeta">' + (p.is_online ? 'Online' : 'Offline') +
          (meta.length ? ' - ' + meta.join(' - ') : '') + '</div>' +
        '<a class="pbtn" href="#" onclick="abrir(' + JSON.stringify(p.session_key) + ');return false;">Abrir ficha</a>'
      );
      grupo.addLayer(m);
    });
    mapa.addLayer(grupo);

    // Abrir a ficha do cliente e responsabilidade do app, nao do WebView.
    function abrir(chave) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ tipo: 'abrir', sessionKey: chave }));
    }

    if (pontos.length) {
      mapa.fitBounds(grupo.getBounds(), { padding: [40, 40], maxZoom: 16 });
    } else {
      mapa.setView([-14.235, -51.925], 4); // Brasil, quando ninguem tem coordenada
    }
  </script>
</body>
</html>`;
}

export default function MapScreen() {
  const navigation = useNavigation();
  const webRef = useRef(null);

  const [pontos, setPontos] = useState([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staleAt, setStaleAt] = useState(null);
  const [oltsPorId, setOltsPorId] = useState({});

  const load = useCallback(async () => {
    try {
      const { data, stale, savedAt } = await withCache('map', async () => {
        const [mapa, olts] = await Promise.all([api.mapPoints(), api.listOlts()]);
        return { items: mapa.items, olts: olts.olts };
      });
      const porId = {};
      for (const o of data.olts || []) porId[o.id] = o.name;
      setOltsPorId(porId);
      setStaleAt(stale ? savedAt : null);
      setPontos(data.items || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar o mapa');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      load();
      const id = setInterval(() => {
        if (ativo) load();
      }, 30000);
      return () => {
        ativo = false;
        clearInterval(id);
      };
    }, [load])
  );

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pontos.filter((p) => {
      if (filtro === 'online' && !p.is_online) return false;
      if (filtro === 'offline' && p.is_online) return false;
      if (!q) return true;
      return [p.alias, p.name, p.loc_neighborhood, p.loc_city, p.loc_region]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [pontos, busca, filtro]);

  // O HTML e remontado quando os pontos visiveis mudam. Sem coordenada nenhuma
  // nao vale abrir WebView: mostra o aviso de que falta marcar clientes.
  const html = useMemo(() => montarHtml(visiveis, oltsPorId), [visiveis, oltsPorId]);

  const offline = pontos.filter((p) => !p.is_online).length;

  if (loading && !pontos.length) {
    return (
      <View style={styles.screen}>
        <LoadingState />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topo}>
        <ErrorBanner message={error} />
        <StaleBanner savedAt={staleAt} />
        <SearchBar value={busca} onChangeText={setBusca} placeholder="Buscar cliente, bairro, cidade" />
        <View style={styles.filtros}>
          {[
            { id: 'todos', label: `Todos (${pontos.length})` },
            { id: 'online', label: `Online (${pontos.length - offline})` },
            { id: 'offline', label: `Offline (${offline})` },
          ].map((f) => (
            <Pressable
              key={f.id}
              onPress={() => setFiltro(f.id)}
              style={[styles.filtro, filtro === f.id && styles.filtroAtivo]}
            >
              <Text style={[styles.filtroText, filtro === f.id && styles.filtroTextAtivo]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {pontos.length === 0 ? (
        <View style={styles.vazio}>
          <Text style={styles.vazioTitulo}>Nenhum cliente com coordenada</Text>
          <Text style={styles.vazioTexto}>
            Abra a ficha de um cliente e use o botão de GPS para marcar onde ele fica. Os pontos aparecem
            aqui e também no mapa do painel web.
          </Text>
        </View>
      ) : (
        <WebView
          ref={webRef}
          style={styles.mapa}
          originWhitelist={['*']}
          source={{ html }}
          javaScriptEnabled
          onMessage={(e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data);
              if (msg.tipo === 'abrir' && msg.sessionKey) {
                navigation.navigate('ClientDetail', { sessionKey: msg.sessionKey });
              }
            } catch {
              // mensagem que nao e nossa: ignora
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topo: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  filtros: { flexDirection: 'row', gap: 8, marginTop: 10 },
  filtro: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
  },
  filtroAtivo: { backgroundColor: colors.accent, borderColor: colors.accent },
  filtroText: { color: colors.inkFaint, fontSize: 11.5, fontWeight: '700' },
  filtroTextAtivo: { color: '#061024' },
  mapa: { flex: 1, backgroundColor: colors.bg },
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  vazioTitulo: { color: colors.ink, fontSize: 15, fontWeight: '750', marginBottom: 8, textAlign: 'center' },
  vazioTexto: { color: colors.inkFaint, fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
});
