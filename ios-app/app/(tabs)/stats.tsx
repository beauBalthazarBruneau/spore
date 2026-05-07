import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { theme, statusColor } from '../../lib/theme';
import { api, Job, JobStatus, BOARD_STATUSES } from '../../lib/api';

const ALL_STATUSES: JobStatus[] = [
  'new', 'approved', 'needs_tailoring', 'tailoring', 'tailored',
  'ready_to_apply', 'applied', 'interview_invite',
  'declined', 'on_hold', 'rejected', 'skipped',
];

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  approved: 'Approved',
  rejected: 'Rejected',
  skipped: 'Skipped',
  needs_tailoring: 'Needs Tailoring',
  tailoring: 'Tailoring',
  tailored: 'Tailored',
  ready_to_apply: 'Ready to Apply',
  applied: 'Applied',
  interview_invite: 'Interview',
  declined: 'Declined',
  on_hold: 'On Hold',
};

type Counts = Record<string, number>;

export default function StatsScreen() {
  const [counts, setCounts] = useState<Counts>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const jobs = await api.getJobs(ALL_STATUSES);
      const c: Counts = {};
      for (const s of ALL_STATUSES) {
        c[s] = jobs.filter(j => j.status === s).length;
      }
      setCounts(c);
      setTotal(jobs.length);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  const activeStatuses = ALL_STATUSES.filter(s => (counts[s] ?? 0) > 0);

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
      <View style={styles.totalCard}>
        <Text style={styles.totalNum}>{total}</Text>
        <Text style={styles.totalLabel}>total jobs tracked</Text>
      </View>

      <Text style={styles.sectionTitle}>By status</Text>

      {activeStatuses.map(status => {
        const count = counts[status] ?? 0;
        const color = statusColor[status] ?? theme.muted;
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <View key={status} style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.rowLabel}>{STATUS_LABELS[status] ?? status}</Text>
            </View>
            <View style={styles.rowRight}>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.max(pct, 1)}%`, backgroundColor: color }]} />
              </View>
              <Text style={[styles.rowCount, { color }]}>{count}</Text>
            </View>
          </View>
        );
      })}

      {activeStatuses.length === 0 && (
        <Text style={styles.empty}>No jobs tracked yet.</Text>
      )}

      <View style={styles.pipelineCard}>
        <Text style={styles.pipelineTitle}>Pipeline</Text>
        {[
          { label: 'Applied', status: 'applied' },
          { label: 'Interviews', status: 'interview_invite' },
          { label: 'Declined', status: 'declined' },
        ].map(({ label, status }) => (
          <View key={status} style={styles.pipelineRow}>
            <Text style={styles.pipelineLabel}>{label}</Text>
            <Text style={[styles.pipelineCount, { color: statusColor[status] ?? theme.text }]}>
              {counts[status] ?? 0}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  totalCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
    alignItems: 'center',
    marginBottom: 8,
  },
  totalNum: { color: theme.text, fontSize: 48, fontWeight: '800', lineHeight: 52 },
  totalLabel: { color: theme.muted, fontSize: 13, marginTop: 4 },
  sectionTitle: { color: theme.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 130 },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  rowLabel: { color: theme.text, fontSize: 13, fontWeight: '500' },
  rowRight: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  barTrack: { flex: 1, height: 6, backgroundColor: theme.surface2, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  rowCount: { fontSize: 14, fontWeight: '700', width: 28, textAlign: 'right' },
  empty: { color: theme.muted, fontSize: 14, textAlign: 'center', marginTop: 32 },
  pipelineCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginTop: 8,
    gap: 12,
  },
  pipelineTitle: { color: theme.text, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  pipelineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pipelineLabel: { color: theme.muted, fontSize: 14 },
  pipelineCount: { fontSize: 20, fontWeight: '800' },
});
