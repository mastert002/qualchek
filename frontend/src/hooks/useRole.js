import { useAuth } from '../context/AuthContext';

export function useRole() {
  const { user } = useAuth();
  const role = user?.role || 'viewer';

  const isSuper = user?.is_super_admin === true;
  // A super admin may delete any test case. An admin may delete a case they
  // created, or one a non-admin created, but not one another admin created. A
  // tester may delete only the cases they created.
  const canDeleteCase = tc =>
    isSuper ||
    (role === 'admin' && (tc.created_by === user?.id || tc.creator_role !== 'admin')) ||
    (role === 'tester' && tc.created_by === user?.id);

  return {
    role,
    isAdmin:  role === 'admin',
    isTester: role === 'tester',
    isViewer: role === 'viewer',
    // Extra authority over other admins. A flag, not a role - see auth.js.
    isSuperAdmin: user?.is_super_admin === true,
    canCreate:  role === 'admin' || role === 'tester',  // create test cases & runs
    canDelete:  role === 'admin' || role === 'tester' || isSuper,  // per case: canDeleteCase
    canDeleteCase,
    canManage:  role === 'admin',                        // projects, users, team
    canExecute: role === 'admin' || role === 'tester',  // execute test runs
  };
}
