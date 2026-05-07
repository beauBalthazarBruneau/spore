import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, statusColor } from '../../lib/theme';
import { api, Job, JobStatus, BOARD_STATUSES, REJECTION_REASONS } from '../../lib/api';

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
  submitting: 'Submitting',
  submission_failed: 'Failed',
  fetched: 'Fetched',
};

function JobRow({ job, onPress }: { job: Job; onPress: () => void }) {
  const color = statusColor[job.status] ?? theme.muted;
  return (
    <Pressable style={styles.jobRow} onPress={onPress}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <View style={styles.jobInfo}>
        <Text style={styles.jobTitle} numberOfLines={1}>{job.title}</Text>
        <Text style={styles.jobCompany} numberOfLines={1}>{job.company}</Text>
        {job.location && <Text style={styles.jobMeta} numberOfLines={1}>{job.location}</Text>}
      </View>
      {job.score != null && (
        <Text style={[styles.jobScore, { color: scoreColor(job.score) }]}>{job.score}</Text>
      )}
      <Ionicons name="chevron-forward" size={16} color={theme.muted} />
    </Pressable>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return theme.green;
  if (score >= 60) return theme.accent;
  if (score >= 40) return theme.orange;
  return theme.red;
}

type DetailModal = { visible: boolean; job: Job | null };

function JobDetailModal({
  modal,
  onClose,
  onStatusChange,
}: {
  modal: DetailModal;
  onClose: () => void;
  onStatusChange: (job: Job) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<JobStatus | null>(null);
  const job = modal.job;

  useEffect(() => {
    if (job) setSelectedStatus(job.status);
  }, [job]);

  if (!job) return null;

  async function saveStatus() {
    if (!selectedStatus || selectedStatus === job!.status) { onClose(); return; }
    setSaving(true);
    try {
      const updated = await api.patchJob(job!.id, { status: selectedStatus });
      onStatusChange(updated);
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  const color = statusColor[job.status] ?? theme.muted;

  return (
    <Modal
      visible={modal.visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={e => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{job.title}</Text>
              <Text style={styles.detailCompany}>{job.company}</Text>
              <View style={styles.detailMeta}>
                {job.location && (
                  <View style={styles.chip}>
                    <Ionicons name="location-outline" size={12} color={theme.muted} />
                    <Text style={styles.chipText}>{job.location}</Text>
                  </View>
                )}
                {job.salary_range && (
                  <View style={styles.chip}>
                    <Text style={[styles.chipText, { color: theme.green }]}>{job.salary_range}</Text>
                  </View>
                )}
                <View style={[styles.chip, { borderColor: color }]}>
                  <Text style={[styles.chipText, { color }]}>{STATUS_LABELS[job.status] ?? job.status}</Text>
                </View>
              </View>
            </View>

            {job.match_explanation && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Match</Text>
                <Text style={styles.sectionText}>{job.match_explanation}</Text>
              </View>
            )}

            {job.rejection_reason && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Rejection reason</Text>
                <Text style={[styles.sectionText, { color: theme.red }]}>
                  {job.rejection_reason.replace(/_/g, ' ')}
                  {job.rejection_note ? ` — ${job.rejection_note}` : ''}
                </Text>
              </View>
            )}

            {job.notes && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Notes</Text>
                <Text style={styles.sectionText}>{job.notes}</Text>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Move to</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusRow}>
                {BOARD_STATUSES.map(s => (
                  <Pressable
                    key={s}
                    style={[
                      styles.statusChip,
                      selectedStatus === s && styles.statusChipActive,
                    ]}
                    onPress={() => setSelectedStatus(s)}
                  >
                    <Text style={[
                      styles.statusChipText,
                      selectedStatus === s && { color: statusColor[s] ?? theme.accent },
                    ]}>
                      {STATUS_LABELS[s] ?? s}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            {job.description && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Description</Text>
                <Text style={styles.sectionText} numberOfLines={10}>{job.description}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.detailActions}>
            <Pressable style={[styles.detailBtn, styles.detailBtnCancel]} onPress={onClose}>
              <Text style={styles.detailBtnCancelText}>Close</Text>
            </Pressable>
            <Pressable
              style={[styles.detailBtn, styles.detailBtnSave, saving && { opacity: 0.6 }]}
              onPress={saveStatus}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.detailBtnSaveText}>Save</Text>
              }
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function JobsScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<DetailModal>({ visible: false, job: null });

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const all = await api.getJobs(BOARD_STATUSES);
      setJobs(all);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = BOARD_STATUSES.reduce<Record<string, Job[]>>((acc, s) => {
    acc[s] = jobs.filter(j => j.status === s);
    return acc;
  }, {});

  function handleStatusChange(updated: Job) {
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            tintColor={theme.accent}
          />
        }
      >
        {BOARD_STATUSES.map(status => {
          const section = grouped[status] ?? [];
          if (section.length === 0) return null;
          const color = statusColor[status] ?? theme.muted;
          return (
            <View key={status} style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <View style={[styles.sectionDot, { backgroundColor: color }]} />
                <Text style={styles.sectionHeader}>{STATUS_LABELS[status]}</Text>
                <Text style={styles.sectionCount}>{section.length}</Text>
              </View>
              {section.map(job => (
                <JobRow
                  key={job.id}
                  job={job}
                  onPress={() => setDetail({ visible: true, job })}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>

      <JobDetailModal
        modal={detail}
        onClose={() => setDetail(d => ({ ...d, visible: false }))}
        onStatusChange={handleStatusChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, paddingBottom: 32, gap: 4 },
  section: { marginBottom: 16 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionHeader: {
    flex: 1,
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCount: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  sectionLabel: { color: theme.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  sectionText: { color: theme.text, fontSize: 14, lineHeight: 20 },
  statusRow: { flexDirection: 'row' },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    marginBottom: 4,
    gap: 10,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  jobInfo: { flex: 1, gap: 2 },
  jobTitle: { color: theme.text, fontSize: 14, fontWeight: '600' },
  jobCompany: { color: theme.accent, fontSize: 12 },
  jobMeta: { color: theme.muted, fontSize: 11 },
  jobScore: { fontSize: 15, fontWeight: '700', flexShrink: 0 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '85%',
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  detailHeader: { marginBottom: 16 },
  detailTitle: { color: theme.text, fontSize: 20, fontWeight: '700', lineHeight: 26 },
  detailCompany: { color: theme.accent, fontSize: 15, fontWeight: '600', marginTop: 2 },
  detailMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { color: theme.muted, fontSize: 12 },
  statusChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: theme.surface2,
  },
  statusChipActive: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  statusChipText: { color: theme.muted, fontSize: 13 },
  detailActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  detailBtn: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  detailBtnCancel: { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border },
  detailBtnCancelText: { color: theme.text, fontWeight: '600' },
  detailBtnSave: { backgroundColor: theme.accent },
  detailBtnSaveText: { color: '#fff', fontWeight: '700' },
});
