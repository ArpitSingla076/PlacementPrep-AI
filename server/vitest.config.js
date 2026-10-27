import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Test-only values. These are NOT real secrets.
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars-long',
      MONGODB_URI: process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/placementprep_test',
      CLIENT_URL: 'http://localhost:5173',
      BCRYPT_ROUNDS: '4', // fast hashing for tests only
      MAX_UPLOAD_MB: '1',
      MAX_RESUMES_PER_USER: '3',
      VECTOR_SEARCH_MODE: 'local',
      CHUNK_SIZE_CHARS: '400',
      CHUNK_OVERLAP_CHARS: '80',
      MAX_DOC_UPLOAD_MB: '1',
      MAX_DOCS_PER_USER: '3',
      MAX_DOC_PAGES: '5',
    },
    fileParallelism: false, // test files share one database
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
