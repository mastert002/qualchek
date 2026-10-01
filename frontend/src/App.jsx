import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './components/ConfirmDialog';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RequestTrialPage from './pages/RequestTrialPage';
import PlatformConsole from './pages/PlatformConsole';
import SetPasswordPage from './pages/SetPasswordPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import AuditLogPage from './pages/AuditLogPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDashboard from './pages/ProjectDashboard';
import TestCasesPage from './pages/TestCasesPage';
import TestCaseDetail from './pages/TestCaseDetail';
import TestRunsPage from './pages/TestRunsPage';
import TestRunDetail from './pages/TestRunDetail';
import ReportsPage from './pages/ReportsPage';
import UsersPage from './pages/UsersPage';
import JiraSettingsPage from './pages/JiraSettingsPage';
import CIIntegrationPage from './pages/CIIntegrationPage';
import CrawlerPage from './pages/CrawlerPage';
import CrawlerSettingsPage from './pages/CrawlerSettingsPage';
import BrowserRecordPage from './pages/BrowserRecordPage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/projects" replace /> : children;
}

export default function App() {
  return (
    <ToastProvider>
    <ConfirmProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/request-trial" element={<PublicRoute><RequestTrialPage /></PublicRoute>} />
          <Route path="/signup" element={<Navigate to="/request-trial" replace />} />
          <Route path="/platform" element={<PlatformConsole />} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
          <Route path="/set-password" element={<SetPasswordPage />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectDashboard />} />
            <Route path="projects/:projectId/test-cases" element={<TestCasesPage />} />
            <Route path="projects/:projectId/test-cases/:caseId" element={<TestCaseDetail />} />
            <Route path="projects/:projectId/runs" element={<TestRunsPage />} />
            <Route path="projects/:projectId/runs/:runId" element={<TestRunDetail />} />
            <Route path="projects/:projectId/reports" element={<ReportsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="settings/jira" element={<JiraSettingsPage />} />
            <Route path="projects/:projectId/ci" element={<CIIntegrationPage />} />
            <Route path="projects/:projectId/crawler" element={<CrawlerPage />} />
            <Route path="projects/:projectId/crawler/settings" element={<CrawlerSettingsPage />} />
            <Route path="projects/:projectId/record" element={<BrowserRecordPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ConfirmProvider>
    </ToastProvider>
  );
}
