import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { ErrorBanner } from '../components/common';
import PrimaryButton from '../components/PrimaryButton';

export default function LoginScreen() {
  const { serverUrl, updateServerUrl, login } = useAuth();
  const [url, setUrl] = useState(serverUrl);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleTest() {
    setTesting(true);
    setTestResult('');
    try {
      const clean = url.trim().replace(/\/+$/, '');
      await api.testConnection(clean);
      setTestResult('ok');
    } catch (err) {
      setTestResult(err.message || 'Falha ao conectar');
    } finally {
      setTesting(false);
    }
  }

  async function handleLogin() {
    if (!url || !username || !password) return;
    setLoading(true);
    setError('');
    try {
      await updateServerUrl(url);
      await login(username, password);
    } catch (err) {
      setError(err.message || 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.shell} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Text style={styles.title}>Monitor</Text>
          <Text style={styles.subtitle}>MikroTik PPPoE</Text>
        </View>

        <Text style={styles.label}>Servidor</Text>
        <View style={styles.serverRow}>
          <TextInput
            style={[styles.input, styles.serverInput]}
            value={url}
            onChangeText={setUrl}
            placeholder="http://192.168.0.10:3001"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>
        <Text onPress={handleTest} style={styles.testLink}>
          {testing ? 'Testando…' : 'Testar conexão'}
        </Text>
        {testResult === 'ok' && <Text style={styles.testOk}>Servidor respondeu ✓</Text>}
        {testResult && testResult !== 'ok' && <Text style={styles.testFail}>{testResult}</Text>}

        <Text style={styles.label}>Usuário</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Senha</Text>
        <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />

        <ErrorBanner message={error} />

        <PrimaryButton label={loading ? 'Entrando…' : 'Entrar'} onPress={handleLogin} disabled={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  brand: { marginBottom: 24 },
  title: { color: colors.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.inkFaint, fontSize: 13, marginTop: 2 },
  label: { color: colors.inkSoft, fontSize: 12, fontWeight: '650', marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
    fontSize: 15,
  },
  serverRow: { flexDirection: 'row', gap: 8 },
  serverInput: { flex: 1 },
  testLink: { color: colors.accent, fontSize: 12, marginTop: 8, fontWeight: '650' },
  testOk: { color: colors.ok, fontSize: 12, marginTop: 4 },
  testFail: { color: colors.bad, fontSize: 12, marginTop: 4 },
});
