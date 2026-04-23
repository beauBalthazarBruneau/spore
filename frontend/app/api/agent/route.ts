import { NextRequest, NextResponse } from 'next/server';
import { runMycel, clearSessionId } from '@mycel';
import { getMycelMessages, logMycelMessage, insertMycelDivider } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(getMycelMessages());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message: string = body.message ?? '';

  if (!message.trim()) {
    return new Response('Missing message', { status: 400 });
  }

  logMycelMessage('user', message, 'web');

  const agentStream = runMycel(message);

  let assistantText = '';
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transformed = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const { text: t } = JSON.parse(line.slice(6));
          if (t) assistantText += t;
        } catch { /* skip */ }
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (assistantText) logMycelMessage('assistant', assistantText, 'web');
    },
  });

  return new Response(agentStream.pipeThrough(transformed), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function DELETE() {
  clearSessionId();
  insertMycelDivider('web');
  return new Response(null, { status: 204 });
}
