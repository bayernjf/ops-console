/**
 * Local fake webhook receiver for T-M8-05 notification validation.
 *
 *   WEBHOOK_RECEIVER_PORT=3023 node scripts/fake-webhook-receiver.ts
 *
 * Routes (pure node:http, zero deps):
 *  - POST /hook               append the notification payload as one JSONL line
 *  - GET  /received           list received payloads
 *       ?decisionId=id        filter by payload.decisionId
 *       ?event=pending         filter by payload.event
 *       ?limit=n              cap returned rows (default 50)
 *  - POST /received/clear     drop all received records (acceptance helper)
 *  - GET  /healthz            readiness
 *
 * Real Feishu / WeChat / email endpoints are external and never used here.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const port = Number(process.env.WEBHOOK_RECEIVER_PORT ?? 3023);
const file = process.env.WEBHOOK_RECEIVER_FILE ?? './data/fake-webhook-received.jsonl';
mkdirSync(dirname(file), { recursive: true });

interface ReceivedRow {
  receivedAt: string;
  payload: Record<string, unknown>;
}

function readAll(): ReceivedRow[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReceivedRow)
    .filter((row) => row && typeof row.payload === 'object');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  if (req.method === 'POST' && url.pathname === '/hook') {
    const raw = await readBody(req).catch(() => '');
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      appendFileSync(file, `${JSON.stringify({ receivedAt: new Date().toISOString(), payload: parsed })}\n`);
      sendJson(res, 200, { ok: true });
    } catch (thrown) {
      sendJson(res, 400, { ok: false, error: String(thrown) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/received/clear') {
    writeFileSync(file, '');
    sendJson(res, 200, { ok: true, cleared: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/received') {
    let rows = readAll();
    const decisionId = url.searchParams.get('decisionId');
    const event = url.searchParams.get('event');
    if (decisionId) rows = rows.filter((r) => r.payload.decisionId === decisionId);
    if (event) rows = rows.filter((r) => r.payload.event === event);
    const limit = Number(url.searchParams.get('limit') ?? '50');
    rows = rows.slice(-limit);
    sendJson(res, 200, { count: rows.length, total: readAll().length, records: rows });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    sendJson(res, 200, { status: 'ok', service: 'fake-webhook-receiver', file });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`fake webhook receiver listening on http://127.0.0.1:${port} (file ${file})`);
});
