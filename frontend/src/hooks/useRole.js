import { useAuth } from '../context/AuthContext';

export function useRole() {
  const { user } = useAuth();
  const role = user?.role || 'viewer';

  return {
    role,
    isAdmin:  role === 'admin',
    isTester: role === 'tester',
    isViewer: role === 'viewer',
    // Extra authority over other admins. A flag, not a role - see auth.js.
    isSuperAdmin: user?.is_super_admin === true,
    canCreate:  role === 'admin' || role === 'tester',  // create test cases & runs
    canDelete:  role === 'admin',                        // delete anything
    canManage:  role === 'admin',                        // projects, users, team
    canExecute: role === 'admin' || role === 'tester',  // execute test runs
  };
}
