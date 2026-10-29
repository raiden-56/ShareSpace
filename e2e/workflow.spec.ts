import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * The complete core workflow from the product spec:
 * register → create group → add members → equal split → custom split → balances →
 * suggestions → partial repayment → remaining balances → budget → plan-linked expense →
 * report → CSV export → unauthorized access is blocked.
 */

const run = Date.now().toString(36);
const alice = { name: 'Alice Rao', email: `alice-${run}@example.com`, password: 'correct-horse-9' };
const mallory = { name: 'Mallory', email: `mallory-${run}@example.com`, password: 'correct-horse-9' };
const groupName = `Goa Trip ${run}`;

async function register(page: Page, user: typeof alice) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/** New users get the guided tour on Overview; this flow does not use it, so skip it whenever it appears. */
async function skipTourWhenShown(page: Page) {
  const tour = page.getByRole('dialog', { name: 'Welcome to ShareSpace' });
  await page.addLocatorHandler(tour, async () => {
    await tour.getByRole('button', { name: 'Skip tour' }).click();
  });
}

async function selectOption(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

async function openAddExpense(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByRole('dialog', { name: 'Add expense' })).toBeVisible();
  return page.getByRole('dialog', { name: 'Add expense' });
}

test('core shared-expense workflow', async ({ page, browser }) => {
  await skipTourWhenShown(page);
  // 1. Register and go through onboarding (create a group with members).
  await register(page, alice);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: /Create a group/ }).click();

  // 2. Create a group (type + name).
  await page.getByRole('radio', { name: /Trip/ }).click();
  await page.getByLabel('Group name').fill(groupName);
  await page.getByRole('button', { name: 'Continue' }).click();

  // 3. Add members (placeholders, no emails).
  await page.getByLabel('Person 1 name').fill('Bob');
  await page.getByRole('button', { name: 'Add person' }).click();
  await page.getByLabel('Person 2 name').fill('Chen');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('combobox', { name: 'Group currency' })).toContainText('INR');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page).toHaveURL(/\/groups\/[^/]+$/);
  await expect(page.getByRole('heading', { name: groupName })).toBeVisible();
  const groupUrl = page.url();

  // 4–6. Record an equal split and verify each participant's share before and after saving.
  let dialog = await openAddExpense(page);
  await dialog.getByLabel('What was it for?').fill('Beach dinner');
  await dialog.getByRole('textbox', { name: 'Amount', exact: true }).fill('300');
  const preview = dialog.getByLabel('Shares preview');
  await expect(preview).toContainText('Alice Rao (you)');
  await expect(preview.getByText('₹100.00')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Add expense' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Expense added')).toBeVisible();

  await page.goto(`${groupUrl}/expenses`);
  await page.getByRole('link', { name: /Beach dinner/ }).click();
  await expect(page.getByRole('heading', { name: 'Beach dinner' })).toBeVisible();
  await expect(page.getByText('₹100.00').first()).toBeVisible();

  // 7. Second expense with a custom (exact) split, paid by Bob, Chen not involved.
  dialog = await openAddExpense(page);
  await dialog.getByLabel('What was it for?').fill('Airport taxi');
  await dialog.getByRole('textbox', { name: 'Amount', exact: true }).fill('90');
  await selectOption(page, 'Paid by', /Bob/);
  await dialog.getByRole('button', { name: /^Exact/ }).click();
  await dialog.getByRole('button', { name: 'Chen' }).click(); // deselect Chen
  await dialog.getByLabel('Amount for Alice Rao').fill('30');
  await dialog.getByLabel('Amount for Bob').fill('60');
  await expect(dialog.getByText(/Split adds up to ₹90.00/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Add expense' }).click();
  await expect(dialog).toBeHidden();

  // 8. Verify balances: Alice +170 (paid 300, share 130); Bob −70 (paid 90, share 160); Chen −100.
  await page.goto(`${groupUrl}/balances`);
  const table = page.getByRole('table', { name: 'Member balances' });
  await expect(table.getByRole('row', { name: /Alice Rao/ })).toContainText('you get back ₹170.00');
  await expect(table.getByRole('row', { name: /Bob/ })).toContainText('owes ₹70.00');
  await expect(table.getByRole('row', { name: /Chen/ })).toContainText('owes ₹100.00');

  // 9. Settlement suggestions.
  await expect(page.getByText('Chen pays you')).toBeVisible();
  await expect(page.getByText('Bob pays you')).toBeVisible();

  // 10. Record a partial repayment: Chen pays Alice ₹40 of ₹100.
  const chenRow = page.getByText('Chen pays you').locator('xpath=ancestor::div[contains(@class,"MuiStack-root")][2]');
  await chenRow.getByRole('button', { name: 'Record payment' }).click();
  const settle = page.getByRole('dialog', { name: 'Record a repayment' });
  await settle.getByLabel('Amount paid').fill('40');
  await settle.getByRole('button', { name: 'Cash' }).click();
  await expect(settle.getByText(/Chen owes ₹60.00/)).toBeVisible();
  await settle.getByRole('button', { name: 'Record repayment' }).click();
  await expect(settle).toBeHidden();

  // 11. Remaining balances reflect the partial repayment.
  await expect(table.getByRole('row', { name: /Chen/ })).toContainText('owes ₹60.00');
  await expect(table.getByRole('row', { name: /Alice Rao/ })).toContainText('you get back ₹130.00');
  await expect(page.getByText('Chen paid you', { exact: true })).toBeVisible();

  // 12. Create a group budget.
  await page.goto(`${groupUrl}/budget`);
  await page.getByRole('button', { name: /Set a budget/ }).first().click();
  await page.getByLabel(/Total budget/).fill('5000');
  await page.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByText('Recorded spending', { exact: true })).toBeVisible();
  await expect(page.getByText('₹390.00').first()).toBeVisible();

  // 13. Create a plan and associate an expense with it.
  await page.goto(`${groupUrl}/plans`);
  await page.getByRole('button', { name: 'New plan' }).first().click();
  await page.getByLabel('Title').fill('Beach day');
  await page.getByRole('button', { name: 'Create plan' }).click();
  // Creating a plan opens it.
  await expect(page).toHaveURL(/\/plans\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Beach day' })).toBeVisible();
  await page.getByRole('tablist', { name: 'Plan sections' }).getByRole('tab', { name: 'Budget' }).click();
  await page.getByRole('button', { name: 'Add expense to this plan' }).first().click();
  dialog = page.getByRole('dialog', { name: 'Add expense' });
  await dialog.getByLabel('What was it for?').fill('Ferry tickets');
  await dialog.getByRole('textbox', { name: 'Amount', exact: true }).fill('120');
  await expect(dialog.getByRole('combobox', { name: 'Plan (optional)' })).toContainText('Beach day');
  await dialog.getByRole('button', { name: 'Add expense' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tablist', { name: 'Plan sections' }).getByRole('tab', { name: 'Expenses' }).click();
  await expect(page.getByRole('link', { name: /Ferry tickets/ })).toBeVisible();

  // 14. Generate a report that uses the real data (3 expenses = ₹510.00).
  await page.goto('/reports');
  await expect(page.getByText('₹510.00').first()).toBeVisible();

  // 15. Export the group's expenses as CSV.
  await page.goto(`${groupUrl}/expenses`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export CSV/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/expenses\.csv$/);
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('Beach dinner');
  expect(csv).toContain('Airport taxi');
  expect(csv).toContain('Ferry tickets');

  // 16. An unauthorized user cannot access the group.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await skipTourWhenShown(other);
  await register(other, mallory);
  await expect(other).toHaveURL(/\/onboarding/);
  await other.getByRole('button', { name: 'Skip for now' }).click();
  await expect(other.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await other.goto(groupUrl);
  await expect(other.getByText('It may have been removed, or you may not have access to it.')).toBeVisible();
  await expect(other.getByText(groupName)).toHaveCount(0);
  const apiStatus = await other.evaluate(async (url) => (await fetch(`/api/groups/${url.split('/groups/')[1]}`)).status, groupUrl);
  expect(apiStatus).toBe(404);
  await otherContext.close();
});
