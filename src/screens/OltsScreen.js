import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius } from '../theme';
import { api } from '../api';
import { Card, ErrorBanner } from '../components/common';
import PrimaryButton from '../components/PrimaryButton';

function Chip({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PortLabelRow({ port, value, busy, onSave }) {
  const [text, setText] = useState(value || '');

  useEffect(() => {
    setText(value || '');
  }, [value]);

  return (
    <View style={styles.portLabelRow}>
      <Text style={styles.portLabelTag}>Porta {port}</Text>
      <TextInput
        style={styles.portLabelInput}
        value={text}
        editable={!busy}
        onChangeText={setText}
        placeholder="ex: Bairro Alto"
        placeholderTextColor={colors.inkFaint}
        onBlur={() => {
          if (text.trim() !== (value || '')) onSave(port, text.trim());
        }}
      />
    </View>
  );
}

export default function OltsScreen() {
  const [olts, setOlts] = useState([]);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newPortCount, setNewPortCount] = useState('16');
  const [creating, setCreating] = useState(false);

  const [labelOltId, setLabelOltId] = useState(0);
  const [portLabels, setPortLabels] = useState({});
  const [labelsBusy, setLabelsBusy] = useState(false);

  const [calibOltId, setCalibOltId] = useState(0);
  const [calibration, setCalibration] = useState(null);
  const [calibrationClients, setCalibrationClients] = useState([]);
  const [calibrationBusy, setCalibrationBusy] = useState(false);

  const loadOlts = useCallback(async () => {
    try {
      const res = await api.listOlts();
      setOlts(res.olts || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Falha ao carregar OLTs');
    }
  }, []);

  const loadLabels = useCallback(async () => {
    try {
      const res = await api.portLabels(labelOltId);
      setPortLabels(res.labels || {});
    } catch {
      // segue com o valor anterior
    }
  }, [labelOltId]);

  const loadCalibration = useCallback(async () => {
    try {
      const res = await api.portCalibrationStatus();
      setCalibration(res.active || null);
      setCalibrationClients(res.clients || []);
    } catch {
      // segue com o valor anterior
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadOlts();
      loadCalibration();
      const id = setInterval(() => {
        if (active) loadCalibration();
      }, 5000);
      return () => {
        active = false;
        clearInterval(id);
      };
    }, [loadOlts, loadCalibration])
  );

  useEffect(() => {
    loadLabels();
  }, [loadLabels]);

  function oltPortCount(oltId) {
    const olt = olts.find((o) => o.id === Number(oltId));
    return olt ? olt.port_count : 8;
  }

  async function handleCreateOlt() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await api.createOlt(newName.trim(), Number(newPortCount));
      if (!res.ok) {
        Alert.alert('Erro', res.error || 'Falha ao criar OLT');
        return;
      }
      setOlts((prev) => [...prev, res.olt].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewPortCount('16');
    } catch (err) {
      Alert.alert('Erro', err.message || 'Falha ao criar OLT');
    } finally {
      setCreating(false);
    }
  }

  function handleDeleteOlt(olt) {
    Alert.alert('Remover OLT', `Remover "${olt.name}"? Os clientes ligados a ela ficam sem OLT/porta.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteOlt(olt.id);
            setOlts((prev) => prev.filter((o) => o.id !== olt.id));
            if (labelOltId === olt.id) setLabelOltId(0);
            if (calibOltId === olt.id) setCalibOltId(0);
          } catch (err) {
            Alert.alert('Erro', err.message || 'Falha ao remover');
          }
        },
      },
    ]);
  }

  async function handleSaveLabel(port, label) {
    setLabelsBusy(true);
    try {
      const res = await api.setPortLabel(labelOltId, port, label);
      setPortLabels((prev) => {
        const next = { ...prev };
        if (res.label) next[port] = res.label;
        else delete next[port];
        return next;
      });
    } catch (err) {
      Alert.alert('Erro', err.message || 'Falha ao salvar nome da porta');
    } finally {
      setLabelsBusy(false);
    }
  }

  async function handleStartCalibration(port) {
    setCalibrationBusy(true);
    try {
      const res = await api.startPortCalibration(port, calibOltId || null);
      setCalibration(res.active);
      setCalibrationClients([]);
    } catch (err) {
      Alert.alert('Erro', err.message || 'Não foi possível iniciar');
    } finally {
      setCalibrationBusy(false);
    }
  }

  async function handleApplyCalibration() {
    if (!calibration) return;
    const n = calibrationClients.length;
    Alert.alert('Aplicar porta', `Aplicar Porta ${calibration.port} a ${n} cliente${n === 1 ? '' : 's'} e encerrar a calibração?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Aplicar',
        onPress: async () => {
          setCalibrationBusy(true);
          try {
            await api.applyPortCalibration();
            setCalibration(null);
            setCalibrationClients([]);
          } catch (err) {
            Alert.alert('Erro', err.message || 'Falha ao aplicar');
          } finally {
            setCalibrationBusy(false);
          }
        },
      },
    ]);
  }

  function handleCancelCalibration() {
    Alert.alert('Cancelar calibração', 'Cancelar sem aplicar nenhuma porta?', [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Cancelar calibração',
        style: 'destructive',
        onPress: async () => {
          setCalibrationBusy(true);
          try {
            await api.cancelPortCalibration();
            setCalibration(null);
            setCalibrationClients([]);
          } finally {
            setCalibrationBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12 }}>
      <ErrorBanner message={error} />

      <Card title="Equipamentos OLT" count={olts.length}>
        {olts.length === 0 && <Text style={styles.muted}>Nenhuma OLT cadastrada ainda (opcional).</Text>}
        {olts.map((o) => (
          <View key={o.id} style={styles.oltRow}>
            <Text style={styles.oltName}>
              {o.name} <Text style={styles.oltPorts}>{o.port_count}p</Text>
            </Text>
            <Pressable onPress={() => handleDeleteOlt(o)} hitSlop={8}>
              <Text style={styles.removeText}>Remover</Text>
            </Pressable>
          </View>
        ))}
        <Text style={styles.label}>Nome da OLT</Text>
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="ex: OLT VSOL"
          placeholderTextColor={colors.inkFaint}
        />
        <Text style={styles.label}>Quantidade de portas</Text>
        <TextInput
          style={styles.input}
          value={newPortCount}
          onChangeText={setNewPortCount}
          keyboardType="number-pad"
          placeholderTextColor={colors.inkFaint}
        />
        <PrimaryButton label={creating ? 'Adicionando…' : 'Adicionar OLT'} onPress={handleCreateOlt} disabled={creating || !newName.trim()} />
      </Card>

      <Card title="Nomear portas">
        <View style={styles.chipRow}>
          <Chip label="Genérico (8p)" active={labelOltId === 0} onPress={() => setLabelOltId(0)} />
          {olts.map((o) => (
            <Chip key={o.id} label={`${o.name} (${o.port_count}p)`} active={labelOltId === o.id} onPress={() => setLabelOltId(o.id)} />
          ))}
        </View>
        {Array.from({ length: oltPortCount(labelOltId) }, (_, i) => i + 1).map((p) => (
          <PortLabelRow key={p} port={p} value={portLabels[p]} busy={labelsBusy} onSave={handleSaveLabel} />
        ))}
      </Card>

      <Card title="Testar porta (calibração)">
        <Text style={styles.muted}>
          Enquanto ativo, alertas de queda em massa ficam pausados e dá pra aplicar a porta em lote pra quem cair.
        </Text>
        {calibration ? (
          <View>
            <Text style={styles.calibTitle}>Testando Porta {calibration.port}</Text>
            <Text style={styles.muted}>
              {calibrationClients.length} cliente{calibrationClients.length === 1 ? '' : 's'} caíram desde o início
            </Text>
            {calibrationClients.map((c) => (
              <Text key={c.session_key} style={styles.calibClient}>
                • {c.alias || c.name}
              </Text>
            ))}
            <PrimaryButton label="Aplicar e encerrar" onPress={handleApplyCalibration} disabled={calibrationBusy} />
            <PrimaryButton label="Cancelar calibração" onPress={handleCancelCalibration} disabled={calibrationBusy} tone="danger" />
          </View>
        ) : (
          <View>
            <View style={styles.chipRow}>
              <Chip label="Genérico (8p)" active={calibOltId === 0} onPress={() => setCalibOltId(0)} />
              {olts.map((o) => (
                <Chip key={o.id} label={`${o.name} (${o.port_count}p)`} active={calibOltId === o.id} onPress={() => setCalibOltId(o.id)} />
              ))}
            </View>
            <View style={styles.chipRow}>
              {Array.from({ length: oltPortCount(calibOltId) }, (_, i) => i + 1).map((p) => (
                <Chip key={p} label={String(p)} active={false} onPress={() => handleStartCalibration(p)} />
              ))}
            </View>
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  muted: { color: colors.inkFaint, fontSize: 12, marginBottom: 8 },
  label: { color: colors.inkFaint, fontSize: 11, fontWeight: '650', marginTop: 8, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: colors.ink,
    fontSize: 13,
  },
  oltRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  oltName: { color: colors.ink, fontSize: 13, fontWeight: '650' },
  oltPorts: { color: colors.inkFaint, fontWeight: '500' },
  removeText: { color: colors.bad, fontSize: 12, fontWeight: '650' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '650' },
  chipTextActive: { color: '#061024' },
  portLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  portLabelTag: { color: colors.inkFaint, fontSize: 12, fontWeight: '650', width: 62 },
  portLabelInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: colors.ink,
    fontSize: 13,
  },
  calibTitle: { color: colors.amber, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  calibClient: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
});
