import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import { DEFAULT_PREFERENCES } from '@sharespace/core';
import { api } from '../../../api/api';
import type { GroupDetail, Member } from '../../../api/types';
import { makeStore } from '../../../store';
import { buildTheme } from '../../../theme/theme';

const member = (id: string, name: string, isYou = false): Member => ({
  id,
  displayName: name,
  email: null,
  role: isYou ? 'OWNER' : 'MEMBER',
  status: 'ACTIVE',
  userId: isYou ? 'user-1' : null,
  hasAccount: isYou,
  isYou,
  avatarColor: null,
  joinedAt: '2026-01-01T00:00:00.000Z',
  leftAt: null,
});

export const groupFixture: GroupDetail = {
  group: {
    id: 'g1',
    name: 'Goa Trip',
    description: null,
    type: 'TRIP',
    simplifyDebts: true,
    isDirect: false,
    currency: 'INR',
    accent: '#386641',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
    myMemberId: 'm1',
    memberCount: 3,
    members: [],
    totalSpendingMinor: 0,
    expenseCount: 0,
    myNetMinor: 0,
    myPaidMinor: 0,
    pendingTransfers: 0,
    budget: null,
    upcomingPlan: null,
    multiCurrency: false,
    ownerId: 'user-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  role: 'OWNER',
  myMemberId: 'm1',
  members: [member('m1', 'Alice', true), member('m2', 'Bob'), member('m3', 'Chen')],
  categories: [],
};

/** Renders with Redux (cached signed-in user, so no network), a router and the app theme. */
export function renderWithApp(ui: ReactNode, { route = '/' }: { route?: string } = {}) {
  const store = makeStore();
  store.dispatch(
    api.util.upsertQueryData('me', undefined, {
      user: { id: 'user-1', email: 'alice@example.com', name: 'Alice', avatarColor: '#386641', createdAt: '2026-01-01T00:00:00.000Z' },
      preferences: { ...DEFAULT_PREFERENCES, motion: 'reduce', onboardingCompleted: true },
    }),
  );
  return {
    store,
    wrapper: (
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>
          <ThemeProvider theme={buildTheme('light', true)}>{ui}</ThemeProvider>
        </MemoryRouter>
      </Provider>
    ),
  };
}
