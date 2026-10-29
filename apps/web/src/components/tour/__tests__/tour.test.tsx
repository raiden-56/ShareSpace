import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '@sharespace/core';
import { api } from '../../../api/api';
import Help from '../../../pages/Help';
import { renderWithApp } from '../../expenses/__tests__/testUtils';
import { TourProvider } from '../TourProvider';
import { TOUR_STEPS } from '../tourSteps';

/**
 * jsdom's AbortSignal is rejected by Node's Request, so API calls fail before reaching fetch.
 * A minimal Request plus a fetch stub lets the real preferences mutation run end to end.
 */
const sent: { method: string; url: string; body: unknown }[] = [];
beforeEach(() => {
  sent.length = 0;
  class TestRequest {
    url: string;
    method: string;
    headers: Headers;
    body: string | undefined;
    signal: AbortSignal | undefined;
    constructor(url: string, init: RequestInit = {}) {
      this.url = url;
      this.method = init.method ?? 'GET';
      this.headers = new Headers(init.headers);
      this.body = typeof init.body === 'string' ? init.body : undefined;
      this.signal = init.signal ?? undefined;
    }
    clone() {
      return this;
    }
  }
  vi.stubGlobal('Request', TestRequest);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: TestRequest) => {
      const body = req.body ? JSON.parse(req.body) : undefined;
      sent.push({ method: req.method, url: req.url, body });
      return new Response(JSON.stringify({ preferences: { ...DEFAULT_PREFERENCES, onboardingCompleted: true, ...body } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

const preferenceUpdates = () => sent.filter((r) => r.method === 'PATCH' && r.url.endsWith('/me/preferences')).map((r) => r.body);

function renderTour(ui = <div>Overview page</div>, route = '/') {
  const app = renderWithApp(<TourProvider>{ui}</TourProvider>, { route });
  render(app.wrapper);
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('guided tour', () => {
  it('starts by itself on Overview for a new user and shows the first step', async () => {
    renderTour();
    const dialog = await screen.findByRole('dialog', { name: 'Welcome to ShareSpace' }, { timeout: 3000 });
    expect(within(dialog).getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Skip tour' })).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/one-minute tour/);
    await waitFor(() => expect(dialog).toHaveFocus());
  });

  it('moves forward and back, and centres a step whose target is not on screen', async () => {
    const user = userEvent.setup();
    renderTour();
    const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 });
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    const second = screen.getByRole('dialog', { name: 'Groups' });
    expect(within(second).getByText(`Step 2 of ${TOUR_STEPS.length}`)).toBeInTheDocument();
    // There is no Groups navigation in this test, so there is no spotlight to point at.
    expect(screen.queryByTestId('tour-spotlight')).not.toBeInTheDocument();
    await user.click(within(second).getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'Welcome to ShareSpace' })).toBeInTheDocument();
  });

  it('highlights the target element when it is visible', async () => {
    const user = userEvent.setup();
    renderTour(
      <button type="button" data-tour="nav-groups">
        My Groups
      </button>,
    );
    const target = screen.getByRole('button', { name: 'My Groups' });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 120, left: 12, width: 200, height: 42, right: 212, bottom: 162, x: 12, y: 120, toJSON: () => ({}) });
    const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 });
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(await screen.findByTestId('tour-spotlight')).toBeInTheDocument();
  });

  it('skips with Escape, saves that the tour was seen and does not start again', async () => {
    const user = userEvent.setup();
    const { store } = renderTour();
    await screen.findByRole('dialog', {}, { timeout: 3000 });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(preferenceUpdates()).toContainEqual({ tourCompleted: true }));
    expect(store.getState().api.queries['me(undefined)']?.data).toMatchObject({ preferences: { tourCompleted: true } });
    await act(() => new Promise((r) => setTimeout(r, 900)));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves completion after the last step', async () => {
    const user = userEvent.setup();
    const { store } = renderTour();
    await screen.findByRole('dialog', {}, { timeout: 3000 });
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: TOUR_STEPS.at(-1)!.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(preferenceUpdates()).toContainEqual({ tourCompleted: true }));
    expect(store.getState().api.queries['me(undefined)']?.data).toMatchObject({ preferences: { tourCompleted: true } });
  });

  it('does not start by itself once seen, or away from Overview', async () => {
    const seen = renderWithApp(<TourProvider>page</TourProvider>);
    seen.store.dispatch(
      api.util.upsertQueryData('me', undefined, {
        user: { id: 'user-1', email: 'alice@example.com', name: 'Alice', avatarColor: '#386641', createdAt: '2026-01-01T00:00:00.000Z' },
        preferences: { ...DEFAULT_PREFERENCES, onboardingCompleted: true, tourCompleted: true },
      }),
    );
    const { unmount } = render(seen.wrapper);
    await act(() => new Promise((r) => setTimeout(r, 900)));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    renderTour(<div>Groups page</div>, '/groups');
    await act(() => new Promise((r) => setTimeout(r, 900)));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('help page', () => {
  it('covers every topic and replays the tour on request, returning focus afterwards', async () => {
    const user = userEvent.setup();
    renderTour(<Help />, '/help');
    // Let the stored motion preference apply first: PageTransition remounts the page when it changes.
    await act(() => Promise.resolve());
    for (const heading of ['Getting started', 'Adding expenses and splitting them', 'How balances are calculated', 'Simplify debts: on or off', 'Friends and expenses outside groups', 'Repeating expenses', 'FAQ']) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText(/so you are owed ₹50/)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Guide contents' })).toBeInTheDocument();

    const takeTour = screen.getByRole('button', { name: 'Take the tour' });
    await user.click(takeTour);
    const dialog = screen.getByRole('dialog', { name: 'Welcome to ShareSpace' });
    await user.click(within(dialog).getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(takeTour).toHaveFocus());
  });
});
