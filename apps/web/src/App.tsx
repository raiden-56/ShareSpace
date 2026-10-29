import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from './hooks/useAuth';
import { AppShell } from './components/layout/AppShell';
import { ErrorState } from './components/common/States';

const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Overview = lazy(() => import('./pages/Overview'));
const Groups = lazy(() => import('./pages/Groups'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Settlements = lazy(() => import('./pages/Settlements'));
const Friends = lazy(() => import('./pages/Friends'));
const FriendDetail = lazy(() => import('./pages/FriendDetail'));
const Help = lazy(() => import('./pages/Help'));
const Plans = lazy(() => import('./pages/Plans'));
const Reports = lazy(() => import('./pages/Reports'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const Invite = lazy(() => import('./pages/Invite'));
const NotFound = lazy(() => import('./pages/NotFound'));
const GroupLayout = lazy(() => import('./pages/group/GroupLayout'));
const GroupOverview = lazy(() => import('./pages/group/GroupOverview'));
const GroupExpenses = lazy(() => import('./pages/group/GroupExpenses'));
const ExpenseDetail = lazy(() => import('./pages/group/ExpenseDetail'));
const GroupMembers = lazy(() => import('./pages/group/GroupMembers'));
const GroupBalances = lazy(() => import('./pages/group/GroupBalances'));
const GroupBudget = lazy(() => import('./pages/group/GroupBudget'));
const GroupPlans = lazy(() => import('./pages/group/GroupPlans'));
const PlanDetail = lazy(() => import('./pages/group/PlanDetail'));
const GroupActivity = lazy(() => import('./pages/group/GroupActivity'));
const GroupSettings = lazy(() => import('./pages/group/GroupSettings'));

function FullPageSpinner() {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress aria-label="Loading ShareSpace" />
    </Box>
  );
}

/** Protected area: requires a server session. New users are guided through onboarding first. */
function RequireAuth() {
  const { user, preferences, isLoading, isError, refetch } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (isError) {
    return (
      <Box sx={{ maxWidth: 520, mx: 'auto', mt: 10, px: 2 }}>
        <ErrorState error={{ status: 'FETCH_ERROR' }} onRetry={() => refetch()} />
      </Box>
    );
  }
  if (!user) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login${returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`} replace />;
  }
  const inviteFlow = location.pathname.startsWith('/invite/');
  if (preferences && !preferences.onboardingCompleted && !inviteFlow && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (user) {
    const returnTo = new URLSearchParams(location.search).get('returnTo');
    return <Navigate to={returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'} replace />;
  }
  return <>{children}</>;
}

function Shell() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
        <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route element={<Shell />}>
            <Route index element={<Overview />} />
            <Route path="/invite/:token" element={<Invite />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/groups/:groupId" element={<GroupLayout />}>
              <Route index element={<GroupOverview />} />
              <Route path="expenses" element={<GroupExpenses />} />
              <Route path="expenses/:expenseId" element={<ExpenseDetail />} />
              <Route path="members" element={<GroupMembers />} />
              <Route path="balances" element={<GroupBalances />} />
              <Route path="budget" element={<GroupBudget />} />
              <Route path="plans" element={<GroupPlans />} />
              <Route path="plans/:planId" element={<PlanDetail />} />
              <Route path="activity" element={<GroupActivity />} />
              <Route path="settings" element={<GroupSettings />} />
            </Route>
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/settlements" element={<Settlements />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/friends/:friendKey" element={<FriendDetail />} />
            <Route path="/help" element={<Help />} />
            <Route path="/plans" element={<Plans />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
