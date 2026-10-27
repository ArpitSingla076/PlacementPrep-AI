import http from 'node:http';

/**
 * A local stand-in for the Gemini REST API, used ONLY in tests.
 * It mimics the documented wire format (candidates/parts/usageMetadata; {error:{code,message,status}})
 * so the REAL @google/genai SDK and our REAL GeminiLlmProvider run unmodified against it.
 * It proves our request shape, error mapping, retries and timeouts. It does NOT prove Google's servers behave the same.
 */
export async function startFakeGemini() {
  const state = { queue: [], requests: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch { /* not JSON */ }
      state.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const next = state.queue.shift() ?? { status: 200, body: okBody('{}') };
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(next.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(next.body));
      }, next.delayMs ?? 0);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    reply: (...items) => state.queue.push(...items),
    reset: () => { state.queue.length = 0; state.requests.length = 0; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

export const okBody = (text, { finishReason = 'STOP', usage = [100, 50] } = {}) => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason, index: 0 }],
  usageMetadata: { promptTokenCount: usage[0], candidatesTokenCount: usage[1], totalTokenCount: usage[0] + usage[1] },
  modelVersion: 'fake-model',
});

export const errBody = (code, status, message, details) => ({ error: { code, message, status, ...(details && { details }) } });

/** Gemini batchEmbedContents response for n vectors of the given size (non-unit on purpose to prove we normalise). */
export const embedBody = (n, dims = 8, fill = 2) => ({ embeddings: Array.from({ length: n }, () => ({ values: Array(dims).fill(fill) })) });
