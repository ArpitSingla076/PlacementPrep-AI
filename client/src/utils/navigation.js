import {
  LayoutDashboard, Briefcase, ClipboardCheck, FileSearch, BookOpenText, MessagesSquare, ListChecks, ChartColumn, Library, Settings,
} from 'lucide-react';

/**
 * Single source of truth for the sidebar AND for what each page says about its availability.
 * `milestone: null` => implemented. A number => the build milestone in which it arrives.
 */
export const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, milestone: null },
  { path: '/applications', label: 'Applications', icon: Briefcase, milestone: null },
  { path: '/resume-analyzer', label: 'Resume Analyzer', icon: FileSearch, milestone: null },
  { path: '/assistant', label: 'Technical AI Assistant', icon: BookOpenText, milestone: null },
  { path: '/interviews', label: 'Mock Interviews', icon: MessagesSquare, milestone: null },
  { path: '/quizzes', label: 'Quizzes', icon: ClipboardCheck, milestone: null },
  { path: '/preparation-plan', label: 'Preparation Plan', icon: ListChecks, milestone: null },
  { path: '/progress', label: 'Progress', icon: ChartColumn, milestone: null },
  { path: '/documents', label: 'Documents', icon: Library, milestone: null },
  { path: '/settings', label: 'Profile and Settings', icon: Settings, milestone: null },
];
