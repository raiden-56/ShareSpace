import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Netting across expenses and the Friends view: I pay ₹200 for both of us, my friend pays ₹100
 * for both of us, and ShareSpace shows one balance (they owe me ₹50) that settles to zero.
 */

const run = Date.now().toString(36);
const me = { name: 'Asha Iyer', email: `asha-${run}@example.com`, password: 'correct-horse-9' };
const H = { 'X-Requested-With': 'ShareSpace' };
const today = new Date().toISOString().slice(0, 10);

async function skipTourWhenShown(page: Page) {
  const tour = page.getByRole('dialog', { name: 'Welcome to ShareSpace' });
  await page.addLocatorHandler(tour, async () => {
    await tour.getByRole('button', { name: 'Skip tour' }).click();
  });
}

test('expenses paid by different people net into one friend balance', async ({ page }) => {
  // Any uncaught error in the app fails the test (a crash would otherwise just show a blank page).
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.stack ?? err.message));
  await skipTourWhenShown(page);
  await page.goto('/register');
  await page.getByLabel('Your name').fill(me.name);
  await page.getByLabel('Email').fill(me.email);
  await page.getByLabel('Password').fill(me.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: 'Skip for now' }).click();

  // Set-up through the API (same session cookie): a group with Ravi and the two expenses.
  const created = await page.request.post('/api/groups', { headers: H, data: { name: `Flat ${run}`, type: 'HOME', currency: 'INR', members: [{ displayName: 'Ravi' }] } });
  expect(created.status()).toBe(201);
  const groupId = (await created.json()).group.id as string;
  const detail = await (await page.request.get(`/api/groups/${groupId}`)).json();
  const myId = detail.myMemberId as string;
  const raviId = detail.members.find((m: { displayName: string }) => m.displayName === 'Ravi').id as string;
  const both = { method: 'EQUAL', participants: [{ memberId: myId }, { memberId: raviId }] };
  for (const [title, amount, payer] of [['Groceries', 20000, myId], ['Taxi', 10000, raviId]] as const) {
    const res = await page.request.post(`/api/groups/${groupId}/expenses`, {
      headers: H,
      data: { clientRequestId: randomUUID(), title, amountMinor: amount, currency: 'INR', date: today, category: 'food', payers: [{ memberId: payer, amountMinor: amount }], split: both },
    });
    expect(res.status()).toBe(201);
  }

  // The expense list explains each expense from my side.
  await page.goto(`/groups/${groupId}/expenses`);
  await expect(page.getByRole('link', { name: /Groceries/ })).toContainText(/You lent ₹100.00/i);
  await expect(page.getByRole('link', { name: /Taxi/ })).toContainText(/You borrowed ₹50.00/i);

  // Friends: one netted balance.
  await page.goto('/friends');
  const ravi = page.getByRole('link', { name: /Ravi/ });
  await expect(ravi).toContainText(/owes you\s*₹50\.00/);
  await ravi.click();
  await expect(page.getByRole('heading', { name: 'Ravi' })).toBeVisible();

  // Settle up the whole balance.
  await page.getByRole('button', { name: 'Settle up' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settle up with Ravi' });
  await expect(dialog.getByLabel('Amount paid')).toHaveValue('50.00');
  await expect(dialog.getByRole('region', { name: 'Repayments that will be recorded' })).toContainText('₹50.00');
  await dialog.getByRole('button', { name: 'Record repayment' }).click();
  await expect(dialog).toBeHidden();
  expect(pageErrors).toEqual([]);
  await expect(page.getByText('Settled up with Ravi')).toBeVisible();

  await page.goto('/friends');
  await expect(page.getByRole('link', { name: /Ravi/ })).toContainText(/settled up/i);
  const balances = await (await page.request.get(`/api/groups/${groupId}/balances`)).json();
  expect(balances.balances.every((b: { netMinor: number }) => b.netMinor === 0)).toBe(true);
  expect(pageErrors).toEqual([]);
});
