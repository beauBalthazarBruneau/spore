import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  Alert,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../lib/theme';
import { api, Job, REJECTION_REASONS } from '../../lib/api';

const { width: SCREEN_W } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_W * 0.35;
const SKIP_THRESHOLD = 80;
const CARD_ROTATE_DEG = 12;

type RejectionModal = { visible: boolean; reason: string; note: string };

function JobCard({ job }: { job: Job }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.title} numberOfLines={2}>{job.title}</Text>
        <Text style={styles.company}>{job.company}</Text>
        {job.location && <Text style={styles.meta}>{job.location}</Text>}
        {job.salary_range && <Text style={styles.salary}>{job.salary_range}</Text>}
      </View>
      {job.score != null && (
        <View style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>Score</Text>
          <Text style={[styles.scoreValue, { color: scoreColor(job.score) }]}>{job.score}</Text>
        </View>
      )}
      {job.match_explanation && (
        <Text style={styles.explanation} numberOfLines={4}>{job.match_explanation}</Text>
      )}
      {job.description && (
        <ScrollView style={styles.descScroll} nestedScrollEnabled>
          <Text style={styles.description}>{job.description}</Text>
        </ScrollView>
      )}
    </View>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return theme.green;
  if (score >= 60) return theme.accent;
  if (score >= 40) return theme.orange;
  return theme.red;
}

export default function SwipeScreen() {
  const [queue, setQueue] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modal, setModal] = useState<RejectionModal>({ visible: false, reason: '', note: '' });

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const cardOpacity = useSharedValue(1);

  const load = useCallback(async () => {
    setLoading(true);
    setEmpty(false);
    try {
      const jobs = await api.getJobs(['new']);
      setQueue(jobs);
      if (jobs.length === 0) setEmpty(true);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetCard = useCallback(() => {
    'worklet';
    translateX.value = withSpring(0, { damping: 15 });
    translateY.value = withSpring(0, { damping: 15 });
    cardOpacity.value = withTiming(1);
  }, [translateX, translateY, cardOpacity]);

  const flyOut = useCallback((direction: 'left' | 'right' | 'up', onDone: () => void) => {
    'worklet';
    const x = direction === 'left' ? -SCREEN_W * 1.5 : direction === 'right' ? SCREEN_W * 1.5 : 0;
    const y = direction === 'up' ? -600 : 0;
    translateX.value = withTiming(x, { duration: 250 });
    translateY.value = withTiming(y, { duration: 250 });
    cardOpacity.value = withTiming(0, { duration: 220 }, () => {
      runOnJS(onDone)();
    });
  }, [translateX, translateY, cardOpacity]);

  const advanceQueue = useCallback(() => {
    setQueue(prev => {
      const next = prev.slice(1);
      if (next.length === 0) setEmpty(true);
      return next;
    });
    translateX.value = 0;
    translateY.value = 0;
    cardOpacity.value = 1;
  }, [translateX, translateY, cardOpacity]);

  const doApprove = useCallback(async () => {
    if (queue.length === 0 || submitting) return;
    const job = queue[0];
    setSubmitting(true);
    flyOut('right', async () => {
      try {
        await api.patchJob(job.id, { status: 'approved' });
      } catch (e: any) {
        Alert.alert('Error', e.message);
      } finally {
        advanceQueue();
        setSubmitting(false);
      }
    });
  }, [queue, submitting, flyOut, advanceQueue]);

  const doSkip = useCallback(async () => {
    if (queue.length === 0 || submitting) return;
    const job = queue[0];
    setSubmitting(true);
    flyOut('up', async () => {
      try {
        await api.patchJob(job.id, { status: 'skipped' });
      } catch (e: any) {
        Alert.alert('Error', e.message);
      } finally {
        advanceQueue();
        setSubmitting(false);
      }
    });
  }, [queue, submitting, flyOut, advanceQueue]);

  const openRejectModal = useCallback(() => {
    setModal({ visible: true, reason: REJECTION_REASONS[0], note: '' });
    runOnJS(() => {})();
  }, []);

  const doReject = useCallback(async () => {
    if (queue.length === 0 || submitting) return;
    const job = queue[0];
    setModal(m => ({ ...m, visible: false }));
    setSubmitting(true);
    flyOut('left', async () => {
      try {
        await api.patchJob(job.id, {
          status: 'rejected',
          rejection_reason: modal.reason || undefined,
          rejection_note: modal.note || undefined,
        });
      } catch (e: any) {
        Alert.alert('Error', e.message);
      } finally {
        advanceQueue();
        setSubmitting(false);
      }
    });
  }, [queue, submitting, flyOut, advanceQueue, modal]);

  const gesture = Gesture.Pan()
    .onUpdate(e => {
      translateX.value = e.translationX;
      translateY.value = e.translationY < 0 ? e.translationY : 0;
    })
    .onEnd(e => {
      const absX = Math.abs(e.translationX);
      const goingLeft = e.translationX < -SWIPE_THRESHOLD;
      const goingRight = e.translationX > SWIPE_THRESHOLD;
      const goingUp = e.translationY < -SKIP_THRESHOLD && absX < SWIPE_THRESHOLD;

      if (goingRight) {
        runOnJS(doApprove)();
      } else if (goingLeft) {
        runOnJS(openRejectModal)();
        runOnJS(resetCard)();
      } else if (goingUp) {
        runOnJS(doSkip)();
      } else {
        translateX.value = withSpring(0, { damping: 15 });
        translateY.value = withSpring(0, { damping: 15 });
      }
    });

  const cardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-SCREEN_W, 0, SCREEN_W],
      [-CARD_ROTATE_DEG, 0, CARD_ROTATE_DEG],
      Extrapolation.CLAMP,
    );
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: `${rotate}deg` },
      ],
      opacity: cardOpacity.value,
    };
  });

  const approveOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));

  const rejectOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));

  const skipOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [-SKIP_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  if (empty) {
    return (
      <View style={styles.center}>
        <Ionicons name="checkmark-circle" size={48} color={theme.green} />
        <Text style={styles.emptyTitle}>Queue empty</Text>
        <Text style={styles.emptyText}>No new jobs to review.</Text>
        <Pressable style={styles.refreshBtn} onPress={load}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  const current = queue[0];

  return (
    <View style={styles.container}>
      <View style={styles.counter}>
        <Text style={styles.counterText}>{queue.length} remaining</Text>
      </View>

      <View style={styles.stack}>
        {queue[1] && (
          <View style={[styles.cardWrapper, styles.cardBack]}>
            <JobCard job={queue[1]} />
          </View>
        )}

        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.cardWrapper, cardStyle]}>
            <Animated.View style={[styles.actionBadge, styles.approveBadge, approveOpacity]}>
              <Text style={styles.approveBadgeText}>YES</Text>
            </Animated.View>
            <Animated.View style={[styles.actionBadge, styles.rejectBadge, rejectOpacity]}>
              <Text style={styles.rejectBadgeText}>SKIP</Text>
            </Animated.View>
            <Animated.View style={[styles.actionBadge, styles.skipBadge, skipOpacity]}>
              <Text style={styles.skipBadgeText}>LATER</Text>
            </Animated.View>
            <JobCard job={current} />
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, styles.rejectBtn]}
          onPress={() => {
            setModal({ visible: true, reason: REJECTION_REASONS[0], note: '' });
          }}
          disabled={submitting}
        >
          <Ionicons name="close" size={28} color={theme.red} />
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.skipActionBtn]}
          onPress={doSkip}
          disabled={submitting}
        >
          <Ionicons name="time-outline" size={22} color={theme.muted} />
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.approveBtn]}
          onPress={doApprove}
          disabled={submitting}
        >
          <Ionicons name="checkmark" size={28} color={theme.green} />
        </Pressable>
      </View>

      <Modal
        visible={modal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setModal(m => ({ ...m, visible: false }));
        }}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setModal(m => ({ ...m, visible: false }))}
        >
          <Pressable style={styles.modalSheet} onPress={e => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Reject job</Text>
            <Text style={styles.modalSubtitle}>{current.title} at {current.company}</Text>

            <Text style={styles.fieldLabel}>Reason</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reasonRow}>
              {REJECTION_REASONS.map(r => (
                <Pressable
                  key={r}
                  style={[styles.reasonChip, modal.reason === r && styles.reasonChipActive]}
                  onPress={() => setModal(m => ({ ...m, reason: r }))}
                >
                  <Text style={[styles.reasonChipText, modal.reason === r && styles.reasonChipTextActive]}>
                    {r.replace(/_/g, ' ')}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Note (optional)</Text>
            <TextInput
              style={styles.noteInput}
              value={modal.note}
              onChangeText={v => setModal(m => ({ ...m, note: v }))}
              placeholder="Add a note..."
              placeholderTextColor={theme.muted}
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setModal(m => ({ ...m, visible: false }))}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnConfirm]} onPress={doReject}>
                <Text style={styles.modalBtnConfirmText}>Reject</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  counter: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  counterText: { color: theme.muted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  stack: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardWrapper: {
    width: SCREEN_W - 32,
    position: 'absolute',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  cardBack: {
    transform: [{ scale: 0.96 }, { translateY: 12 }],
    opacity: 0.7,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    maxHeight: 520,
  },
  cardHeader: {
    padding: 20,
    gap: 4,
  },
  title: { color: theme.text, fontSize: 20, fontWeight: '700', lineHeight: 26 },
  company: { color: theme.accent, fontSize: 15, fontWeight: '600', marginTop: 2 },
  meta: { color: theme.muted, fontSize: 13, marginTop: 2 },
  salary: { color: theme.green, fontSize: 13, fontWeight: '600', marginTop: 4 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  scoreLabel: { color: theme.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreValue: { fontSize: 20, fontWeight: '800' },
  explanation: { color: theme.muted, fontSize: 13, lineHeight: 19, paddingHorizontal: 20, paddingBottom: 12 },
  descScroll: { maxHeight: 200, paddingHorizontal: 20, paddingBottom: 16 },
  description: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  actionBadge: {
    position: 'absolute',
    top: 20,
    zIndex: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 2,
  },
  approveBadge: { right: 20, borderColor: theme.green },
  approveBadgeText: { color: theme.green, fontWeight: '800', fontSize: 16 },
  rejectBadge: { left: 20, borderColor: theme.red },
  rejectBadgeText: { color: theme.red, fontWeight: '800', fontSize: 16 },
  skipBadge: { alignSelf: 'center', borderColor: theme.muted, top: 20 },
  skipBadgeText: { color: theme.muted, fontWeight: '800', fontSize: 16 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    paddingVertical: 24,
    paddingBottom: 32,
  },
  actionBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  rejectBtn: { borderColor: theme.red, backgroundColor: 'rgba(239,68,68,0.08)' },
  approveBtn: { borderColor: theme.green, backgroundColor: 'rgba(34,197,94,0.08)', width: 64, height: 64, borderRadius: 32 },
  skipActionBtn: { borderColor: theme.border, backgroundColor: theme.surface },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  emptyText: { color: theme.muted, fontSize: 14 },
  refreshBtn: { marginTop: 8, backgroundColor: theme.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  refreshText: { color: '#fff', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalSubtitle: { color: theme.muted, fontSize: 13, marginBottom: 20 },
  fieldLabel: { color: theme.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  reasonRow: { flexDirection: 'row' },
  reasonChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: theme.surface2,
  },
  reasonChipActive: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  reasonChipText: { color: theme.muted, fontSize: 13, fontWeight: '500' },
  reasonChipTextActive: { color: theme.accent },
  noteInput: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    color: theme.text,
    padding: 12,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  modalBtnCancel: { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border },
  modalBtnCancelText: { color: theme.text, fontWeight: '600' },
  modalBtnConfirm: { backgroundColor: theme.red },
  modalBtnConfirmText: { color: '#fff', fontWeight: '700' },
});
