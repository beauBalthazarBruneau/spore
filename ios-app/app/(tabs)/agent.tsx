import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import { theme } from '../../lib/theme';
import { api, AgentMessage } from '../../lib/api';
import { getBaseUrl } from '../../lib/storage';

type DisplayMessage = AgentMessage | {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
  optimistic: true;
};

export default function AgentScreen() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const navigation = useNavigation();

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await api.getAgentMessages();
      setMessages(msgs);
    } catch {}
  }, []);

  useEffect(() => {
    loadMessages().finally(() => setLoading(false));
  }, [loadMessages]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={async () => {
            try {
              await api.clearAgentSession();
              await loadMessages();
            } catch {}
          }}
          style={{ paddingHorizontal: 16 }}
        >
          <Ionicons name="refresh-outline" size={20} color={theme.muted} />
        </Pressable>
      ),
    });
  }, [navigation, loadMessages]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setStreaming(true);

    const tempId = Date.now();
    const now = new Date().toISOString();

    setMessages(prev => [
      ...prev,
      { id: tempId, role: 'user', text, created_at: now, optimistic: true },
      { id: tempId + 1, role: 'assistant', text: '', created_at: now, optimistic: true },
    ]);
    scrollToBottom();

    try {
      const base = await getBaseUrl();
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${base}/api/agent`);
        xhr.setRequestHeader('Content-Type', 'application/json');
        let offset = 0;

        const processChunk = (raw: string) => {
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6);
            if (payload === '[DONE]') return;
            try {
              const { text: t } = JSON.parse(payload);
              if (t) {
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last && last.role === 'assistant') {
                    next[next.length - 1] = { ...last, text: last.text + t };
                  }
                  return next;
                });
                scrollToBottom();
              }
            } catch {}
          }
        };

        xhr.onprogress = () => {
          const newText = xhr.responseText.slice(offset);
          offset = xhr.responseText.length;
          processChunk(newText);
        };

        xhr.onload = () => {
          if (xhr.status >= 400) { reject(new Error(`HTTP ${xhr.status}`)); return; }
          processChunk(xhr.responseText.slice(offset));
          loadMessages().then(resolve).catch(resolve);
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(JSON.stringify({ message: text }));
      });
    } catch (err) {
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && 'optimistic' in last) {
          next[next.length - 1] = { ...last, text: `Error: ${(err as Error).message}` };
        }
        return next;
      });
    } finally {
      setStreaming(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="sparkles" size={32} color={theme.muted} />
            <Text style={styles.emptyText}>Ask Mycel anything about your job search</Text>
          </View>
        )}
        {messages.map(msg => {
          if (msg.role === 'divider') {
            return (
              <View key={msg.id} style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>new session</Text>
                <View style={styles.dividerLine} />
              </View>
            );
          }
          const isUser = msg.role === 'user';
          return (
            <View
              key={msg.id}
              style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}
            >
              <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
                {msg.text}
              </Text>
              {!isUser && msg.text === '' && streaming && (
                <ActivityIndicator size="small" color={theme.accent} style={{ marginTop: 4 }} />
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message Mycel"
          placeholderTextColor={theme.muted}
          multiline
          maxLength={2000}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          blurOnSubmit={false}
          editable={!streaming}
        />
        <Pressable
          onPress={sendMessage}
          disabled={!input.trim() || streaming}
          style={({ pressed }) => [
            styles.sendBtn,
            (!input.trim() || streaming) && styles.sendBtnDisabled,
            pressed && styles.sendBtnPressed,
          ]}
        >
          {streaming
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="arrow-up" size={18} color="#fff" />
          }
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyText: { color: theme.muted, fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  bubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: theme.accent },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextUser: { color: '#fff', fontWeight: '500' },
  bubbleTextAssistant: { color: theme.text },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: { color: theme.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
  input: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: theme.text,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnPressed: { opacity: 0.8 },
});
