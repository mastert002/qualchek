import { Outlet, NavLink, useParams, useNavigate } from 'react-router-dom';
import TrialBanner from './TrialBanner';
import { useAuth } from '../context/AuthContext';
import {
  ClipboardCheck, FolderKanban, PlayCircle, BarChart3, ScrollText,
  LogOut, ChevronRight, Home, Menu, X, UserCog, Settings, Zap, Globe, Video, KeyRound
} from 'lucide-react';
import ChangePasswordModal from './ChangePasswordModal';
import IdleWarningModal from './IdleWarningModal';
import { useIdleLogout } from '../hooks/useIdleLogout';
import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';
import { useRole } from '../hooks/useRole';

function Sidebar({ projectId, open, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [changingPassword, setChangingPassword] = useState(false);
  const { isViewer } = useRole();

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get(`/projects/${projectId}`).then(r => r.data),
    enabled: !!projectId,
  });

  const navItem = (to, icon, label) => (
    <NavLink
      to={to}
      end
      onClick={onClose}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={onClose} />
      )}
      <aside className={`fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 flex flex-col z-30 transition-transform duration-200 ${
        open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <div className="p-4 border-b border-gray-200 flex items-center gap-2">
          <ClipboardCheck className="text-brand-600 w-6 h-6" />
          <span className="font-bold text-gray-900 text-lg">QualChek</span>
          <button onClick={onClose} className="ml-auto lg:hidden text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 overflow-y-auto space-y-1">
          {navItem('/projects', <Home className="w-4 h-4" />, 'Projects')}
          {user?.role === 'admin' && navItem('/users', <UserCog className="w-4 h-4" />, 'Users')}
          {user?.role === 'admin' && navItem('/audit', <ScrollText className="w-4 h-4" />, 'Audit Log')}
          {user?.role === 'admin' && navItem('/settings/jira', <Settings className="w-4 h-4" />, 'Jira Settings')}

          {projectId && project && (
            <>
              <div className="pt-3 pb-1 flex items-center gap-1 text-xs font-semibold text-gray-400 uppercase tracking-wider px-3">
                <ChevronRight className="w-3 h-3" />
                <span className="truncate">{project.name}</span>
              </div>
              {navItem(`/projects/${projectId}`, <BarChart3 className="w-4 h-4" />, 'Dashboard')}
              {navItem(`/projects/${projectId}/test-cases`, <FolderKanban className="w-4 h-4" />, 'Test Cases')}
              {navItem(`/projects/${projectId}/runs`, <PlayCircle className="w-4 h-4" />, 'Test Runs')}
              {navItem(`/projects/${projectId}/reports`, <BarChart3 className="w-4 h-4" />, 'Reports')}
              {!isViewer && navItem(`/projects/${projectId}/ci`, <Zap className="w-4 h-4" />, 'CI Integration')}
              {!isViewer && navItem(`/projects/${projectId}/crawler`, <Globe className="w-4 h-4" />, 'Web Crawler')}
              {!isViewer && navItem(`/projects/${projectId}/record`, <Video className="w-4 h-4" />, 'Browser Recording')}
            </>
          )}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-sm font-bold">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate">
                {/* Super admin is a flag on top of role=admin, so show the
                    higher tier rather than the underlying role. */}
                {user?.is_super_admin ? 'super admin' : user?.role}
              </p>
            </div>
            {/* Password self-service is a super-admin-only feature; everyone
                else gets a password via the invite flow. */}
            {user?.is_super_admin && (
              <button onClick={() => setChangingPassword(true)} title="Change password"
                className="text-gray-400 hover:text-brand-600">
                <KeyRound className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => { logout(); navigate('/login'); }} title="Sign out" className="text-gray-400 hover:text-red-500">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      </aside>
    </>
  );
}

export default function Layout() {
  const { projectId } = useParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const endSession = useCallback((reason) => {
    logout();
    navigate('/login' + (reason ? `?reason=${reason}` : ''), { replace: true });
  }, [logout, navigate]);

  const { warning, secondsLeft, staySignedIn } =
    useIdleLogout(!!user, () => endSession('timeout'));

  return (
    <div className="flex h-screen bg-gray-50">
      <TrialBanner />
      <Sidebar projectId={projectId} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col lg:ml-64 min-w-0">
        <header className="bg-white border-b border-gray-200 px-4 py-3 lg:hidden flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-500">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="text-brand-600 w-5 h-5" />
            <span className="font-bold text-gray-900">QualChek</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
        {warning && (
          <IdleWarningModal
            secondsLeft={secondsLeft}
            onStay={staySignedIn}
            onSignOut={() => endSession()}
          />
        )}
      </div>
    </div>
  );
}
