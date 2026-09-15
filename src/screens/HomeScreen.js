import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { colors, radius } from '../theme';
import { api } from '../api';
import { withCache } from '../cache';
import { ErrorBanner, LoadingState, StaleBanner } from '../components/common';
import { formatBps, relativeAgo } from '../format';

// Cores das series validadas com o script de paleta na superficie escura do app
// (#1a1a1e): banda de luminosidade, piso de croma, separacao sob daltonismo
// (deltaE 28.1 protan/deutan) e contraste >= 3:1. O ambar do tema (#fb923c) foi
// reprovado na banda escura (L 0.758), por isso a serie 2 usa o passo correto.
const SERIE_CPU = '#5b8def';
const SERIE_MEM = '#d95926';
// Cinza de de-enfase pro grafico de enfase (hora de pico): recessivo mas ainda
// em 3.43:1 contra a superficie, entao nao depende da regra de alivio.
const DE_ENFASE = '#646e8c';

const GRID = 'rgba(255,255,255,0.07)';
const PONTOS_GRAFICO = 28; // 24h reamostradas: ~1440 amostras nao cabem na tela

// Escalas do eixo de % escolhidas pra cada tick cair num numero redondo. Um teto
// solto (ex: 30 em 4 secoes) produziria 0/8/15/23/30, que se le mal. Cada par
// aqui divide exato em multiplos de 10 ou 20, e a base fica sempre no zero.
const ESCALAS_EIXO = [
  { teto: 20, secoes: 2 },
  { teto: 30, secoes: 3 },
  { teto: 40, secoes: 4 },
  { teto: 50, secoes: 5 },
  { teto: 60, secoes: 3 },
  { teto: 80, secoes: 4 },
  { teto: 100, secoes: 5 },
];

/** Reamostra a serie em N baldes pela media, pra caber no grafico do celular. */
function reamostrar(items, n, pegar) {
  if (!items.length) return [];
  if (items.length <= n) return items.map((it) => pegar(it) ?? 0);
  const tamanho = items.length / n;
  return Array.from({ length: n }, (_, i) => {
    const ini = Math.floor(i * tamanho);
    const fim = Math.max(ini + 1, Math.floor((i + 1) * tamanho));
    const fatia = items.slice(ini, fim);
    const soma = fatia.reduce((acc, it) => acc + (pegar(it) ?? 0), 0);
    return Math.round(soma / fatia.length);
  });
}

function HeroOnline({ online, conectado }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.heroLabel}>Clientes online agora</Text>
      <Text style={styles.heroValue}>{online ?? '—'}</Text>
      <View style={styles.heroStatus}>
        <Ionicons
          name={conectado ? 'checkmark-circle' : 'alert-circle'}
          size={14}
          color={conectado ? colors.ok : colors.bad}
        />
        <Text style={[styles.heroStatusText, { color: conectado ? colors.ok : colors.bad }]}>
          {conectado ? 'CCR respondendo' : 'CCR sem resposta'}
        </Text>
      </View>
    </View>
  );
}

function StatTile({ label, value, tom }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, tom ? { color: tom } : null]}>{value}</Text>
    </View>
  );
}

function Secao({ titulo, sub, children, acao }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle}>{titulo}</Text>
          {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
        </View>
        {acao}
      </View>
      {children}
    </View>
  );
}

/** Legenda: obrigatoria com 2+ series, pra identidade nao depender so da cor. */
function Legenda({ itens }) {
  return (
    <View style={styles.legenda}>
      {itens.map((it) => (
        <View key={it.label} style={styles.legendaItem}>
          <View style={[styles.legendaDot, { backgroundColor: it.cor }]} />
          <Text style={styles.legendaText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

function SemDados({ texto }) {
  return (
    <View style={styles.semDados}>
      <Text style={styles.semDadosText}>{texto}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();

  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staleAt, setStaleAt] = useState(null);

  // Os numeros ao vivo (online, quedas, status do CCR) sao consultas de indice,
  // custam ~0ms e valem a pena a cada 10s.
  const loadRapido = useCallback(async () => {
    try {
      const { data, stale, savedAt } = await withCache('home:rapido', async () => {
        const [dash, status] = await Promise.all([api.dashboard(), api.status()]);
        return { dash, status };
      });
      setStaleAt(stale ? savedAt : null);
      setDados((atual) => ({ ...atual, ...data }));
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar o painel');
    } finally {
      setLoading(false);
    }
  }, []);

  // O resto e agregacao sobre centenas de milhares de amostras de banda. Uma
  // media por hora do dia sobre 7 dias nao muda em 10 segundos: recalcular
  // nesse ritmo so gastava CPU do servidor. O TTL do cache do servidor e de
  // 2 min, entao pedir a cada 2 min casa com ele.
  const loadPesado = useCallback(async () => {
    try {
      const { data } = await withCache('home:pesado', async () => {
        const tz = new Date().getTimezoneOffset();
        const [sys, hist, hourly, top, notifs] = await Promise.all([
          api.system(),
          api.systemHistory(24),
          api.hourlyLoad(7, tz),
          api.topConsumers(24, 5),
          api.notifications({ page: 1, pageSize: 3 }),
        ]);
        return { sys, hist, hourly, top, notifs };
      });
      setDados((atual) => ({ ...atual, ...data }));
    } catch {
      // os numeros ao vivo continuam valendo; nao derruba a tela por isso
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      loadRapido();
      loadPesado();
      const rapido = setInterval(() => {
        if (ativo) loadRapido();
      }, 10000);
      const pesado = setInterval(() => {
        if (ativo) loadPesado();
      }, 120000);
      return () => {
        ativo = false;
        clearInterval(rapido);
        clearInterval(pesado);
      };
    }, [loadRapido, loadPesado])
  );

  if (loading && !dados) {
    return (
      <View style={styles.screen}>
        <LoadingState />
      </View>
    );
  }

  const larguraGrafico = Math.max(220, width - 24 /* padding da tela */ - 28 /* padding do card */);

  const hist = dados?.hist?.items || [];
  const cpuSerie = reamostrar(hist, PONTOS_GRAFICO, (h) => h.cpu_load).map((value) => ({ value }));
  const memSerie = reamostrar(hist, PONTOS_GRAFICO, (h) =>
    h.total_memory ? ((h.total_memory - h.free_memory) / h.total_memory) * 100 : 0
  ).map((value) => ({ value }));

  // Teto do eixo com folga sobre o maior valor, arredondado na dezena, sempre
  // ancorado no zero. Um CCR ocioso fica em 10-20%: num eixo fixo de 0-100 as
  // duas linhas grudam na base e o grafico nao diz nada. A base fica no zero e
  // o eixo segue rotulado em %, entao a leitura nao fica distorcida.
  const maiorPct = Math.max(...cpuSerie.map((d) => d.value), ...memSerie.map((d) => d.value), 0);
  const escala = ESCALAS_EIXO.find((e) => maiorPct * 1.25 <= e.teto) || ESCALAS_EIXO[ESCALAS_EIXO.length - 1];

  const horas = dados?.hourly?.items || [];
  const cargaValores = horas.map((h) => (h.avgDownBps || 0) + (h.avgUpBps || 0));
  const pico = cargaValores.length ? Math.max(...cargaValores) : 0;
  const horaPico = cargaValores.indexOf(pico);
  // Forma "enfase": a hora de pico e o ponto da tela, o resto e contexto.
  // O valor do pico vai no subtitulo em vez de flutuar sobre a barra: quando o
  // pico cai na primeira ou na ultima hora, um rotulo centrado na barra
  // estouraria a borda do grafico, e rotulo cortado e pior que rotulo nenhum.
  const cargaBarras = horas.map((h, i) => ({
    value: cargaValores[i],
    label: i % 6 === 0 ? String(h.hour).padStart(2, '0') : '',
    frontColor: i === horaPico && pico > 0 ? SERIE_CPU : DE_ENFASE,
  }));
  const subCarga =
    pico > 0
      ? `Média de 7 dias · pico às ${String(horas[horaPico].hour).padStart(2, '0')}h, ${formatBps(pico)}`
      : 'Média dos últimos 7 dias';

  const top = dados?.top?.items || [];
  const topMax = top.length ? Math.max(...top.map((t) => t.avgDownBps || 0)) : 1;

  const alertas = dados?.notifs?.items || [];
  const recurso = dados?.sys?.resource || {};
  const memPct =
    recurso.totalMemory && recurso.freeMemory != null
      ? Math.round(((recurso.totalMemory - recurso.freeMemory) / recurso.totalMemory) * 100)
      : null;

  const subSistema =
    memPct != null ? `Últimas 24 horas · memória agora em ${memPct}%` : 'Últimas 24 horas, em %';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.conteudo}>
      <ErrorBanner message={error} />
      <StaleBanner savedAt={staleAt} />

      <HeroOnline online={dados?.dash?.online} conectado={Boolean(dados?.status?.connected)} />

      {/* Tres tiles, nao quatro: com quatro em 375px o rotulo "Voltaram 24h"
          quebra em duas linhas. A memoria ja tem o seu numero no card abaixo. */}
      <View style={styles.tiles}>
        <StatTile label="Quedas 24h" value={dados?.dash?.disconnected24h ?? '—'} tom={colors.bad} />
        <StatTile label="Voltaram 24h" value={dados?.dash?.connected24h ?? '—'} tom={colors.ok} />
        <StatTile label="CPU agora" value={recurso.cpuLoad != null ? `${recurso.cpuLoad}%` : '—'} />
      </View>

      <Secao titulo="CPU e memória" sub={subSistema}>
        {cpuSerie.length ? (
          <>
            <Legenda
              itens={[
                { label: 'CPU', cor: SERIE_CPU },
                { label: 'Memória', cor: SERIE_MEM },
              ]}
            />
            <LineChart
              data={cpuSerie}
              data2={memSerie}
              color1={SERIE_CPU}
              color2={SERIE_MEM}
              thickness={2}
              height={150}
              width={larguraGrafico}
              adjustToWidth
              initialSpacing={6}
              maxValue={escala.teto}
              noOfSections={escala.secoes}
              yAxisLabelSuffix="%"
              hideDataPoints
              rulesColor={GRID}
              rulesThickness={1}
              yAxisThickness={0}
              xAxisThickness={1}
              xAxisColor={GRID}
              yAxisTextStyle={styles.eixoTexto}
              curved
            />
          </>
        ) : (
          <SemDados texto="Sem histórico ainda. O servidor coleta a cada minuto." />
        )}
      </Secao>

      <Secao titulo="Carga por hora" sub={subCarga}>
        {cargaBarras.length ? (
          <BarChart
            data={cargaBarras}
            height={130}
            width={larguraGrafico}
            barWidth={7}
            spacing={4}
            initialSpacing={6}
            barBorderTopLeftRadius={4}
            barBorderTopRightRadius={4}
            noOfSections={3}
            hideYAxisText
            rulesColor={GRID}
            rulesThickness={1}
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor={GRID}
            xAxisLabelTextStyle={styles.eixoTexto}
            disablePress
          />
        ) : (
          <SemDados texto="Sem amostras de banda suficientes ainda." />
        )}
      </Secao>

      <Secao
        titulo="Maiores consumidores"
        sub="Média de download nas últimas 24h"
        acao={
          <Pressable onPress={() => navigation.navigate('Estatísticas')} hitSlop={8}>
            <Text style={styles.link}>Ver tudo</Text>
          </Pressable>
        }
      >
        {top.length ? (
          <View style={styles.barras}>
            {top.map((t) => {
              const pct = Math.max(2, Math.round(((t.avgDownBps || 0) / topMax) * 100));
              return (
                <View key={t.name} style={styles.barraLinha}>
                  <Text style={styles.barraNome} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <View style={styles.barraTrilha}>
                    <View style={[styles.barraFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.barraValor}>{formatBps(t.avgDownBps || 0)}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <SemDados texto="Nenhum consumo registrado nas últimas 24h." />
        )}
      </Secao>

      <Secao
        titulo="Últimos alertas"
        acao={
          <Pressable onPress={() => navigation.navigate('Alertas')} hitSlop={8}>
            <Text style={styles.link}>Ver tudo</Text>
          </Pressable>
        }
      >
        {alertas.length ? (
          alertas.map((a) => (
            <View key={a.id} style={styles.alerta}>
              <View style={styles.alertaDot} />
              <View style={styles.alertaTexto}>
                <Text style={styles.alertaTitulo} numberOfLines={1}>
                  {a.title}
                </Text>
                <Text style={styles.alertaTempo}>{relativeAgo(a.created_at)}</Text>
              </View>
            </View>
          ))
        ) : (
          <SemDados texto="Nenhum alerta ainda." />
        )}
      </Secao>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  conteudo: { padding: 12, paddingBottom: 24 },

  hero: { paddingHorizontal: 4, paddingTop: 6, paddingBottom: 18 },
  heroLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: '650' },
  // Figura heroi: uma so por tela, >= 48px, na mesma sans do resto.
  heroValue: { color: colors.ink, fontSize: 56, fontWeight: '800', letterSpacing: -2, marginTop: 2 },
  heroStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  heroStatusText: { fontSize: 12, fontWeight: '700' },

  tiles: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tile: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tileLabel: { color: colors.inkFaint, fontSize: 9.5, fontWeight: '650', textTransform: 'uppercase' },
  tileValue: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: 3 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  cardHeadText: { flex: 1 },
  cardTitle: { color: colors.ink, fontSize: 14, fontWeight: '750' },
  cardSub: { color: colors.inkFaint, fontSize: 11, marginTop: 2 },
  link: { color: colors.accent, fontSize: 12, fontWeight: '700' },

  legenda: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  legendaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendaDot: { width: 8, height: 8, borderRadius: 4 },
  // Texto nunca veste a cor da serie: o ponto colorido ao lado carrega a identidade.
  legendaText: { color: colors.inkSoft, fontSize: 11, fontWeight: '650' },

  eixoTexto: { color: colors.inkFaint, fontSize: 9 },

  barras: { gap: 10 },
  barraLinha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barraNome: { color: colors.ink, fontSize: 12, fontWeight: '650', width: 92 },
  barraTrilha: { flex: 1, height: 8, backgroundColor: colors.surface3, borderRadius: 4, overflow: 'hidden' },
  barraFill: { height: '100%', backgroundColor: SERIE_CPU, borderRadius: 4, minWidth: 3 },
  barraValor: { color: colors.inkSoft, fontSize: 11, fontWeight: '700', width: 66, textAlign: 'right' },

  alerta: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7 },
  alertaDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.amber },
  alertaTexto: { flex: 1 },
  alertaTitulo: { color: colors.ink, fontSize: 12, fontWeight: '650' },
  alertaTempo: { color: colors.inkFaint, fontSize: 10.5, marginTop: 1 },

  semDados: { paddingVertical: 18, alignItems: 'center' },
  semDadosText: { color: colors.inkFaint, fontSize: 12, textAlign: 'center' },
});
