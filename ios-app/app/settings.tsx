import { useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { getBaseUrl, setBaseUrl, DEFAULT_BASE } from '../lib/storage';
import { theme } from '../lib/theme';

export default function Settings() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    getBaseUrl().then(setUrl);
  }, []);

  async function save() {
    const trimmed = url.trim().replace(/\/$/, '');
    if (!trimmed) return;
    await setBaseUrl(trimmed);
    Alert.alert('Saved', 'Settings updated.');
    router.back();
  }

  async function test() {
    setStatus('testing');
    try {
      const base = url.trim().replace(/\/$/, '');
      const res = await fetch(`${base}/api/profile`);
      setStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setStatus('fail');
    }
  }

  function reset() {
    setUrl(DEFAULT_BASE);
    setStatus('idle');
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={styles.label}>API Base URL</Text>
      <TextInput
        value={url}
        onChangeText={v => { setUrl(v); setStatus('idle'); }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={DEFAULT_BASE}
        placeholderTextColor={theme.muted}
        style={styles.input}
      />
      <Text style={styles.hint}>
        The URL where Spore's Next.js server is running. Default is localhost:3100. For remote access, use your machine's Tailscale IP.
      </Text>

      <View style={styles.row}>
        <Pressable style={[styles.btn, styles.btnOutline]} onPress={test} disabled={status === 'testing'}>
          {status === 'testing'
            ? <ActivityIndicator size="small" color={theme.muted} />
            : <Text style={[
                styles.btnOutlineText,
                status === 'ok' && { color: theme.green },
                status === 'fail' && { color: theme.red },
              ]}>
                {status === 'ok' ? '✓ Connected' : status === 'fail' ? '✗ Failed' : 'Test connection'}
              </Text>
          }
        </Pressable>
        <Pressable style={styles.btn} onPress={save}>
          <Text style={styles.btnText}>Save</Text>
        </Pressable>
      </View>

      <Pressable style={styles.resetRow} onPress={reset}>
        <Text style={styles.resetText}>Reset to default ({DEFAULT_BASE})</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  label: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: theme.muted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    padding: 12,
    fontSize: 15,
  },
  hint: { color: theme.muted, fontSize: 12, marginTop: 8, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8, marginTop: 16 },
  btn: {
    flex: 1,
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnText: { color: '#fff', fontWeight: '700' },
  btnOutline: {
    backgroundColor: 'transparent',
    borderColor: theme.border,
    borderWidth: 1,
  },
  btnOutlineText: { color: theme.text, fontWeight: '600' },
  resetRow: { marginTop: 24, alignItems: 'center' },
  resetText: { color: theme.muted, fontSize: 12 },
});
