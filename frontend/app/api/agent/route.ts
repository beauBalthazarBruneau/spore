import { NextRequest } from 'next/server';
import { runMycel, clearSessionId } from '@mycel';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message: string = body.message ?? '';

  if (!message.trim()) {
    return new Response('Missing message', { status: 400 });
  }

  const stream = runMycel(message);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function DELETE() {
  clearSessionId();
  return new Response(null, { status: 204 });
}
