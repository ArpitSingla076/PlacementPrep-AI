// Sample resume, job description and a valid model response. Plain module (no Vitest import) so scripts can reuse it.
export { makePdf } from './pdfFixture.js';

export const RESUME_LINES = [
  'Asha Rao',
  'Email: asha.rao@example.com | Phone: +91 98765 43210',
  'Skills: Java, SQL, Git, JavaScript',
  'Projects',
  'Library Management System - Built a library system in Java using Spring and MySQL.',
  'Chat App - Developed a real time chat application using Node.js and Express with MongoDB.',
  'Deployed a small app on a cloud VM and wrote unit tests with JUnit.',
  'Education: B.Tech Computer Science 2019 - 2023, CGPA 8.7',
  'Achievements: Solved 300 problems on LeetCode and won a college hackathon.',
];

export const JD = `We are hiring a Backend Developer. Required: Java, SQL, REST APIs and Git.
Preferred: Docker. Nice to have: AWS knowledge. You will build services and work with a small team.`;

/** A valid model response for RESUME_LINES + JD. Hand-computed score: (3 + 1.5 + 0.75 + 0 + 0.25) / 12 = 45.8 -> 46 */
export function analysisJson(over = {}) {
  return {
    roleTitle: 'Backend Developer',
    requirements: [
      { skill: 'Java', category: 'language', importance: 'required', evidenceLevel: 'demonstrated', matchedTerm: 'Java',
        evidenceQuote: 'Built a library system in Java using Spring and MySQL', note: 'Used in a project.' },
      { skill: 'SQL', category: 'database', importance: 'required', evidenceLevel: 'listed', matchedTerm: 'SQL',
        evidenceQuote: 'Skills: Java, SQL, Git, JavaScript', note: 'Only in the skills list.' },
      { skill: 'REST APIs', category: 'concept', importance: 'required', evidenceLevel: 'inferred', matchedTerm: '',
        evidenceQuote: 'Developed a real time chat application using Node.js and Express with MongoDB', note: 'Express work implies REST.' },
      { skill: 'Docker', category: 'tool', importance: 'preferred', evidenceLevel: 'none', matchedTerm: '', evidenceQuote: '', note: 'Not mentioned.' },
      { skill: 'AWS', category: 'tool', importance: 'bonus', evidenceLevel: 'inferred', matchedTerm: '',
        evidenceQuote: 'Deployed a small app on a cloud VM', note: 'Cloud VM suggests some cloud exposure.' },
    ],
    relevantHighlights: [
      { item: 'Library Management System', whyRelevant: 'Java backend project.', quote: 'Built a library system in Java using Spring and MySQL' },
      { item: 'Invented project', whyRelevant: 'x', quote: 'Led a team of 40 engineers at Google' }, // fabricated quote: must be dropped
    ],
    resumeGaps: ['No internship or work experience is listed.'],
    suggestions: [
      { section: 'Project: Chat App', type: 'clarify_existing', currentText: 'Developed a real time chat application using Node.js and Express with MongoDB',
        suggestion: 'Add how many users or messages it handled, if you know the numbers.', reason: 'Quantified results are easier to evaluate.' },
      { section: 'Skills', type: 'conditional_add', currentText: '',
        suggestion: 'If you have used Docker in any project, add a bullet describing what you containerised.', reason: 'Docker is preferred.' },
    ],
    interviewTopics: [{ topic: 'SQL joins', reason: 'SQL is required and only listed.' }],
    preparationChecklist: [
      { task: 'Learn Docker basics and containerise one project', relatedSkill: 'Docker' },
      { task: 'Write a REST API with proper status codes', relatedSkill: 'REST APIs' },
      { task: 'Revise SQL joins with practice queries', relatedSkill: 'SQL' },
    ],
    interviewQuestions: [{ question: 'Explain the difference between INNER JOIN and LEFT JOIN.', topic: 'SQL', difficulty: 'medium' }],
    ...over,
  };
}

export { NOTES } from '../eval/corpus.js';
