
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SessionManager } from './auth.js';
import { BandLabClient } from './client.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const token = process.env.MCP_AUTH_TOKEN;
if (!token) throw new Error('Missing MCP_AUTH_TOKEN');

const config = loadConfig();
const session = new SessionManager({
  apiBase: config.apiBase,
  sessionKey: config.sessionKey,
  refreshToken: config.refreshToken,
  username: config.username,
  password: config.password,
});
const client = new BandLabClient({
  apiBase: config.apiBase,
  session,
  allowWrites: config.allowWrites,
  minIntervalMs: config.minIntervalMs,
  userAgent: config.userAgent,
});

const httpServer = createServer(async (req, res) => {
  if (req.url !== '/mcp') {
    res.writeHead(404).end('Not found');
    return;
  }

  const auth = req.headers.authorization ?? '';
  const supplied = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
  const expected = Buffer.from(token);

  if (supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)) {
    res.writeHead(401).end('Unauthorized');
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405).end('Method not allowed');
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const mcp = buildServer(client, config);
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    if (!res.headersSent) res.writeHead(400);
    if (!res.writableEnded) res.end(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed' })
    );
  }
});

httpServer.listen(Number(process.env.PORT || 3000), '0.0.0.0');
