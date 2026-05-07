import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { theme } from '../../lib/theme';
import { api, Profile } from '../../lib/api';

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, multiline && styles.fieldInputMulti]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? `Enter ${label.toLowerCase()}`}
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
      />
    </View>
  );
}

function strVal(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    location: '',
    salary_min: '',
    remote_pref: '',
    titles: '',
    locations: '',
    keywords: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const p = await api.getProfile();
      setProfile(p);
      setForm({
        full_name: strVal(p.full_name),
        email: strVal(p.email),
        phone: strVal(p.phone),
        location: strVal(p.location),
        salary_min: p.criteria_json?.salary_min != null ? String(p.criteria_json.salary_min) : '',
        remote_pref: strVal(p.criteria_json?.remote_pref),
        titles: (p.criteria_json?.titles ?? []).join(', '),
        locations: (p.criteria_json?.locations ?? []).join(', '),
        keywords: (p.criteria_json?.keywords ?? []).join(', '),
      });
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const criteria_json = {
        ...(profile?.criteria_json ?? {}),
        titles: form.titles ? form.titles.split(',').map(s => s.trim()).filter(Boolean) : [],
        locations: form.locations ? form.locations.split(',').map(s => s.trim()).filter(Boolean) : [],
        keywords: form.keywords ? form.keywords.split(',').map(s => s.trim()).filter(Boolean) : [],
        salary_min: form.salary_min ? parseInt(form.salary_min, 10) : undefined,
        remote_pref: form.remote_pref || undefined,
      };
      await api.patchProfile({
        full_name: form.full_name || null,
        email: form.email || null,
        phone: form.phone || null,
        location: form.location || null,
        criteria_json,
      });
      Alert.alert('Saved', 'Profile updated.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(true); }}
          tintColor={theme.accent}
        />
      }
    >
      <Text style={styles.sectionTitle}>Personal</Text>

      <Field label="Name" value={form.full_name} onChangeText={v => setForm(f => ({ ...f, full_name: v }))} />
      <Field label="Email" value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} />
      <Field label="Phone" value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))} />
      <Field label="Location" value={form.location} onChangeText={v => setForm(f => ({ ...f, location: v }))} />

      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Job Criteria</Text>

      <Field
        label="Target titles (comma-separated)"
        value={form.titles}
        onChangeText={v => setForm(f => ({ ...f, titles: v }))}
        placeholder="e.g. Software Engineer, Senior Engineer"
        multiline
      />
      <Field
        label="Target locations (comma-separated)"
        value={form.locations}
        onChangeText={v => setForm(f => ({ ...f, locations: v }))}
        placeholder="e.g. New York, Remote"
        multiline
      />
      <Field
        label="Keywords (comma-separated)"
        value={form.keywords}
        onChangeText={v => setForm(f => ({ ...f, keywords: v }))}
        placeholder="e.g. TypeScript, React, Node.js"
        multiline
      />
      <Field
        label="Min salary (USD)"
        value={form.salary_min}
        onChangeText={v => setForm(f => ({ ...f, salary_min: v.replace(/[^0-9]/g, '') }))}
        placeholder="e.g. 120000"
      />
      <Field
        label="Remote preference"
        value={form.remote_pref}
        onChangeText={v => setForm(f => ({ ...f, remote_pref: v }))}
        placeholder="remote / hybrid / onsite"
      />

      <Pressable
        style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        onPress={save}
        disabled={saving}
      >
        {saving
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={styles.saveBtnText}>Save profile</Text>
        }
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  field: { marginBottom: 14 },
  fieldLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fieldInput: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  fieldInputMulti: { minHeight: 72, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
