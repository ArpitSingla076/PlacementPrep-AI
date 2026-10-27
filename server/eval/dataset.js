/**
 * Evaluation questions for the RAG pipeline, over eval/corpus.js.
 *
 * "positive": the answer IS in the notes. `expected.document` is the file and `expected.snippet` is a lowercase phrase
 *             that must appear in a retrieved passage for retrieval to count as a hit.
 * "negative": the answer is NOT anywhere in the notes. The system should say so instead of answering.
 *
 * This is a deliberately SMALL dataset (14 questions). It can reveal gross failures and compare settings (chunk size,
 * threshold, model) but it is far too small to support any accuracy claim. Do not quote its numbers as accuracy.
 */
export const QUESTIONS = [
  { id: 'p1', type: 'positive', question: 'What does an INNER JOIN return?', expected: { document: 'dbms-notes.pdf', snippet: 'inner join returns only the rows' } },
  { id: 'p2', type: 'positive', question: 'How does a LEFT JOIN treat rows with no match in the right table?', expected: { document: 'dbms-notes.pdf', snippet: 'left join returns all rows from the left table' } },
  { id: 'p3', type: 'positive', question: 'What does third normal form require?', expected: { document: 'dbms-notes.pdf', snippet: 'third normal form requires' } },
  { id: 'p4', type: 'positive', question: 'What is first normal form?', expected: { document: 'dbms-notes.pdf', snippet: 'atomic column values' } },
  { id: 'p5', type: 'positive', question: 'What is a deadlock?', expected: { document: 'os-notes.pdf', snippet: 'wait for each other forever' } },
  { id: 'p6', type: 'positive', question: 'Which four conditions must hold for a deadlock to occur?', expected: { document: 'os-notes.pdf', snippet: 'mutual exclusion' } },
  { id: 'p7', type: 'positive', question: 'How does paging avoid external fragmentation?', expected: { document: 'os-notes.pdf', snippet: 'avoids external fragmentation' } },
  { id: 'p8', type: 'positive', question: 'Where can internal fragmentation occur in paging?', expected: { document: 'os-notes.pdf', snippet: 'internal fragmentation in the last page' } },
  { id: 'p9', type: 'positive', question: 'Describe the TCP three way handshake.', expected: { document: 'network-notes.pdf', snippet: 'three way handshake' } },
  { id: 'p10', type: 'positive', question: 'What does the server send in reply to SYN?', expected: { document: 'network-notes.pdf', snippet: 'server replies with syn ack' } },
  { id: 'n1', type: 'negative', question: 'How do Kubernetes pods get scheduled onto nodes?' },
  { id: 'n2', type: 'negative', question: 'Explain the CAP theorem for distributed databases.' },
  { id: 'n3', type: 'negative', question: 'What is the average time complexity of quicksort?' },
  { id: 'n4', type: 'negative', question: 'How does the OAuth 2 authorization code flow work?' },
];
