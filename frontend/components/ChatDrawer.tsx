'use client';

import { useState, useRef, useEffect } from 'react';

type Message = { role: 'user' | 'assistant'; text: string };

export default function ChatDrawer() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem('mycel_messages') ?? '[]');
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('mycel_messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userMessage }]);
    setStreaming(true);
    setMessages((prev) => [...prev, { role: 'assistant', text: '' }]);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let residual = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = residual + decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        residual = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;

          try {
            const { text, error } = JSON.parse(payload);
            if (error) throw new Error(error);
            if (text) {
              assistantText += text;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', text: assistantText };
                return updated;
              });
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', text: `[error: ${msg}]` };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  };

  const clearSession = async () => {
    await fetch('/api/agent', { method: 'DELETE' });
    setMessages([]);
    localStorage.removeItem('mycel_messages');
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-emerald-700 hover:bg-emerald-600 flex items-center justify-center shadow-lg text-xl leading-none"
        title="Open Mycel"
      >
        🍄
      </button>

      <div
        className={`fixed top-0 right-0 h-full w-96 bg-zinc-950 border-l border-zinc-800 z-40 flex flex-col shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="font-semibold text-sm">Mycel</span>
          <div className="flex items-center gap-3">
            <button
              onClick={clearSession}
              className="text-xs text-zinc-500 hover:text-zinc-300"
              title="New session"
            >
              new session
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-zinc-400 hover:text-white text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-zinc-500 text-sm text-center mt-8">
              Ask Mycel about your pipeline.
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <span
                className={`inline-block px-3 py-2 rounded-lg max-w-[85%] text-sm whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-emerald-800 text-emerald-100'
                    : 'bg-zinc-800 text-zinc-200'
                }`}
              >
                {msg.text || (streaming && i === messages.length - 1 ? '…' : '')}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-zinc-800 flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask Mycel..."
            disabled={streaming}
            className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={streaming || !input.trim()}
            className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
}
