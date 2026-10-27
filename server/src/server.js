import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { recoverStaleDocuments, waitForIngestion } from './services/knowledge/ingestion.service.js';

async function main() {
  await connectDB(env.MONGODB_URI);
  console.log('[db] connected');
  await recoverStaleDocuments(); // background embedding jobs do not survive a restart

  const server = createApp().listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // Timeouts: AI requests can legitimately take a minute or more, so the request timeout is generous but finite.
  server.requestTimeout = env.REQUEST_TIMEOUT_MS;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000; // above typical proxy idle timeouts (60s) to avoid sporadic 502s behind a load balancer

  // Graceful shutdown: stop accepting requests, finish in-flight ones, close the DB. Render sends SIGTERM on deploys.
  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(async () => {
      await waitForIngestion(); // let in-flight embedding jobs finish before closing the database
      await disconnectDB();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
});
