import { expect, test, type Page } from '@playwright/test';

/** Checks every main page for horizontal overflow at the breakpoints required by the spec. */

const WIDTHS = [360, 390, 768, 1024, 1280, 1440];
const run = Date.now().toString(36);

async function api(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ShareSpace' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: await res.json() };
    },
    { method, url, body },
  );
}

test('pages have no horizontal overflow at supported widths', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Riya Sharma');
  await page.getByLabel('Email').fill(`riya-${run}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/onboarding/);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/$/);

  // Seed realistic data through the API.
  const created = await api(page, 'POST', '/api/groups', {
    name: 'Flat 4B — Indiranagar',
    type: 'HOME',
    currency: 'INR',
    members: [{ displayName: 'Arjun Mehta' }, { displayName: 'Sana Khan' }],
    budgetMinor: 3000000,
  });
  expect(created.status).toBe(201);
  const groupId = created.json.group.id as string;
  const detail = await api(page, 'GET', `/api/groups/${groupId}`);
  const ids = (detail.json.members as { id: string }[]).map((m) => m.id);
  const today = new Date().toISOString().slice(0, 10);
  for (const [title, amount, category] of [
    ['October rent', 4500000, 'rent'],
    ['Electricity bill', 284750, 'utilities'],
    ['Weekly groceries at the market', 312040, 'groceries'],
  ] as const) {
    const r = await api(page, 'POST', `/api/groups/${groupId}/expenses`, {
      clientRequestId: crypto.randomUUID(),
      title,
      amountMinor: amount,
      currency: 'INR',
      date: today,
      category,
      payers: [{ memberId: ids[0], amountMinor: amount }],
      split: { method: 'EQUAL', participants: ids.map((memberId) => ({ memberId })) },
    });
    expect(r.status).toBe(201);
  }
  const plan = await api(page, 'POST', `/api/groups/${groupId}/plans`, { title: 'House-warming dinner', type: 'DINNER', startDate: today, location: 'Indiranagar', participantIds: ids });
  expect(plan.status).toBe(201);

  const paths = [
    '/',
    '/groups',
    `/groups/${groupId}`,
    `/groups/${groupId}/expenses`,
    `/groups/${groupId}/members`,
    `/groups/${groupId}/balances`,
    `/groups/${groupId}/budget`,
    `/groups/${groupId}/plans`,
    `/groups/${groupId}/plans/${plan.json.plan.id}`,
    `/groups/${groupId}/activity`,
    `/groups/${groupId}/settings`,
    '/expenses',
    '/settlements',
    '/plans',
    '/reports',
    '/notifications',
    '/settings',
  ];

  const problems: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      // Wait until loading skeletons are gone so the real content is measured.
      await page.locator('main').waitFor();
      await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`${width}px ${path}: overflows by ${overflow}px`);
      if ((width === 360 || width === 1440) && ['/', `/groups/${groupId}/balances`, `/groups/${groupId}`, '/reports'].includes(path)) {
        await page.screenshot({ path: `test-results/screens/${width}${path.replace(/\//g, '_').replace(groupId, 'g') || '_home'}.png`, fullPage: true });
      }
    }
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
