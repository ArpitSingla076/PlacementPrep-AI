// Small study-notes corpus for RAG evaluation (also used by the tests). Each entry: filename -> pages -> lines.
const long = (...s) => s.join(' ');
export const NOTES = {
  'dbms-notes.pdf': [
    [long('SQL Joins.', 'An INNER JOIN returns only the rows that have matching values in both tables.',
      'A LEFT JOIN returns all rows from the left table and the matching rows from the right table; where there is no match the right side columns contain NULL.',
      'A RIGHT JOIN is the mirror image of a LEFT JOIN and keeps every row of the right table.')],
    [long('Normalization.', 'Normalization organizes a relational schema to reduce redundancy and update anomalies.',
      'First normal form requires atomic column values. Second normal form removes partial dependencies on a composite key.',
      'Third normal form requires that non key attributes depend only on the primary key and not on other non key attributes.')],
  ],
  'os-notes.pdf': [
    [long('Deadlock.', 'A deadlock occurs when a set of processes wait for each other forever and none can proceed.',
      'Four conditions must hold together: mutual exclusion, hold and wait, no preemption, and circular wait.',
      'Breaking any one of the four conditions prevents deadlock.')],
    [long('Paging.', 'Paging divides physical memory into fixed size frames and logical memory into pages of the same size.',
      'Because any free frame can hold any page, paging avoids external fragmentation, but it can cause internal fragmentation in the last page.')],
  ],
  'network-notes.pdf': [
    [long('TCP three way handshake.', 'TCP establishes a connection with a three way handshake.',
      'The client sends SYN, the server replies with SYN ACK, and the client answers with ACK, after which data can flow in both directions.')],
  ],
};
