import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicOnly, RequireAuth } from './components/RouteGuards.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import AuthPage from './pages/AuthPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import InterviewsPage from './pages/InterviewsPage.jsx';
import InterviewSessionPage from './pages/InterviewSessionPage.jsx';
import PlanPage from './pages/PlanPage.jsx';
import ApplicationsPage from './pages/ApplicationsPage.jsx';
import QuizzesPage from './pages/QuizzesPage.jsx';
import QuizSessionPage from './pages/QuizSessionPage.jsx';
import ComparePage from './pages/ComparePage.jsx';
import ProgressPage from './pages/ProgressPage.jsx';
import ResumeAnalyzerPage from './pages/ResumeAnalyzerPage.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import AssistantPage from './pages/AssistantPage.jsx';
import AnalysisReportPage from './pages/AnalysisReportPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="resume-analyzer" element={<ResumeAnalyzerPage />} />
          <Route path="resume-analyzer/compare" element={<ComparePage />} />
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="quizzes" element={<QuizzesPage />} />
          <Route path="quizzes/:id" element={<QuizSessionPage />} />
          <Route path="resume-analyzer/:id" element={<AnalysisReportPage />} />
          <Route path="interviews" element={<InterviewsPage />} />
          <Route path="interviews/:id" element={<InterviewSessionPage />} />
          <Route path="preparation-plan" element={<PlanPage />} />
          <Route path="progress" element={<ProgressPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
