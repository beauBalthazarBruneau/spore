import { spawn } from 'child_process';
import path from 'path';
import { loadSessionId, saveSessionId } from './session';
import { buildSessionContext } from './context';

// Assumes next dev runs from frontend/; override with SPORE_ROOT env var if needed
const SPORE_ROOT = process.env.SPORE_ROOT ?? path.resolve(process.cwd(), '..');
const MYCEL_DIR = path.join(SPORE_ROOT, 'mycel');

export function runMycel(message: string): ReadableStream<Uint8Array> {
  const sessionId = loadSessionId();
  const encoder = new TextEncoder();

  const isNewSession = !sessionId;
  const finalMessage = isNewSession
    ? `${buildSessionContext()}\n\n[User message]\n${message}`
    : message;

  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--add-dir', MYCEL_DIR,
    '--model', 'claude-sonnet-4-6',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  args.push(finalMessage);

  const proc = spawn('claude', args, { cwd: SPORE_ROOT });

  let buffer = '';
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      proc.stdout.on('data', (chunk: Buffer) => {
        if (closed) return;
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`));
            } else if (event.type === 'assistant' && event.message?.content) {
              // Fallback: full message block (non-streaming mode)
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: block.text })}\n\n`));
                }
              }
            } else if (event.type === 'result') {
              if (event.session_id) saveSessionId(event.session_id);
            }
          } catch {
            // skip malformed JSON lines
          }
        }
      });

      proc.stderr.on('data', () => {
        // MCP server startup noise — intentionally ignored
      });

      proc.on('close', () => {
        if (closed) return;
        closed = true;
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      });

      proc.on('error', (err) => {
        if (closed) return;
        closed = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
        controller.close();
      });
    },
    cancel() {
      closed = true;
      proc.kill();
    },
  });
}

export { clearSessionId } from './session';
