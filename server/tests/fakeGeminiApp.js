import http from 'node:http';
import { hashEmbed } from './fakeEmbedding.js';
import { faithfulRagAnswer } from './ragFake.js';
import { analysisJson } from './sampleData.js';
import { fakeInterviewQuestions, fakeInterviewEvaluation, fakePlan, fakeQuiz } from './aiFakes.js';

/**
 * A scriptable fake of the whole Gemini REST surface this app uses (model list, generateContent, batchEmbedContents),
 * for running the REAL server / CLI scripts end to end without contacting Google. Wire format only: the answers
 * come from test logic, not from a language model. state.mode: 'ok' | 'rate_limit' | 'down' | 'invalid'.
 */
export async function startFakeGeminiApp({ dims = 512 } = {}) {
  const state = { mode: 'ok', requests: [] };
  const gen = (obj) => ({ candidates: [{ content: { role: 'model', parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 150, totalTokenCount: 1050 } });
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(raw); } catch { /* ignore */ }
      const path = req.url.split('?')[0];
      state.requests.push({ method: req.method, path, body });
      const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
      if (req.method === 'GET' && /\/models$/.test(path)) {
        return send(200, { models: [{ name: 'models/fake-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/fake-embed', supportedGenerationMethods: ['embedContent', 'batchEmbedContents'] }] });
      }
      if (/:batchEmbedContents$/.test(path)) {
        if (state.mode === 'embed_down') return send(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'x' } });
        return send(200, { embeddings: (body.requests ?? []).map((r) => ({ values: hashEmbed(r.content?.parts?.[0]?.text ?? '', body.requests[0].outputDimensionality ?? dims) })) });
      }
      if (/:generateContent$/.test(path)) {
        if (state.mode === 'rate_limit') return send(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } });
        if (state.mode === 'down') return send(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'overloaded' } });
        if (state.mode === 'schema_400' && JSON.stringify(body.generationConfig?.responseJsonSchema ?? {}).length > 1500) return send(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The specified schema produces a constraint that has too many states for serving.' } });
        if (state.mode === 'invalid') return send(200, gen('Sorry, here is prose instead of JSON.'));
        const system = body.systemInstruction?.parts?.[0]?.text ?? '';
        const prompt = body.contents?.[0]?.parts?.[0]?.text ?? '';
        if (/technical recruiter/.test(system)) return send(200, gen(analysisJson()));
        if (/numbered sources/.test(system)) return send(200, gen(faithfulRagAnswer(prompt)));
        if (/writing questions/.test(system)) return send(200, gen(fakeInterviewQuestions(prompt)));
        if (/grade a student/.test(system)) return send(200, gen(fakeInterviewEvaluation(prompt)));
        if (/multiple-choice revision questions/.test(system)) return send(200, gen(fakeQuiz(prompt)));
        if (/study actions/.test(system)) return send(200, gen(fakePlan(prompt)));
        return send(200, gen({ language: 'Java', isCompiled: 'yes' }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
