import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

const app = createApp();
const H = { 'X-Requested-With': 'ShareSpace' };
const uuid = () => crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
/** Unique per run so tests never need to wipe the database. */
const run = crypto.randomBytes(4).toString('hex');
const email = (name: string) => `${name}-${run}@example.com`;

type Agent = ReturnType<typeof request.agent>;

async function register(name: string, email: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').set(H).send({ name, email, password: 'correct-horse-9' });
  expect(res.status).toBe(201);
  return agent;
}

const net = (balances: { memberId: string; netMinor: number }[], id: string) => balances.find((b) => b.memberId === id)?.netMinor;

describe('ShareSpace API', () => {
  let alice: Agent;
  let mallory: Agent;
  let groupId: string;
  let ids: { alice: string; bob: string; chen: string };
  let chenInviteUrl: string;
  let firstExpenseId: string;

  beforeAll(async () => {
    alice = await register('Alice', email('alice'));
    mallory = await register('Mallory', email('mallory'));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await alice.post('/api/groups').send({ name: 'x', type: 'TRIP', currency: 'INR' });
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/groups');
    expect(res.status).toBe(401);
  });

  it('does not reveal whether an email is registered on login', async () => {
    const a = await request(app).post('/api/auth/login').set(H).send({ email: email('alice'), password: 'wrong-password-1' });
    const b = await request(app).post('/api/auth/login').set(H).send({ email: email('nobody'), password: 'wrong-password-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('creates a group with placeholder members and an invitation', async () => {
    const res = await alice
      .post('/api/groups')
      .set(H)
      .send({ name: 'Goa Trip', type: 'TRIP', currency: 'INR', members: [{ displayName: 'Bob' }, { displayName: 'Chen', email: email('chen') }] });
    expect(res.status).toBe(201);
    groupId = res.body.group.id;
    expect(res.body.invitations).toHaveLength(1);
    chenInviteUrl = res.body.invitations[0].inviteUrl;

    const detail = await alice.get(`/api/groups/${groupId}`);
    expect(detail.status).toBe(200);
    const byName = Object.fromEntries(detail.body.members.map((m: { displayName: string; id: string }) => [m.displayName, m.id]));
    ids = { alice: byName.Alice, bob: byName.Bob, chen: byName.Chen };
    expect(detail.body.role).toBe('OWNER');
  });

  it('records an equal split and computes balances (₹300 → 100 each, with paise remainder rules)', async () => {
    const clientRequestId = uuid();
    const body = {
      clientRequestId,
      title: 'Beach shack dinner',
      amountMinor: 30001,
      currency: 'INR',
      date: today,
      category: 'food',
      payers: [{ memberId: ids.alice, amountMinor: 30001 }],
      split: { method: 'EQUAL', participants: [{ memberId: ids.alice }, { memberId: ids.bob }, { memberId: ids.chen }] },
    };
    const res = await alice.post(`/api/groups/${groupId}/expenses`).set(H).send(body);
    expect(res.status).toBe(201);
    firstExpenseId = res.body.expense.id;
    expect(res.body.expense.shares.map((s: { amountMinor: number }) => s.amountMinor)).toEqual([10001, 10000, 10000]);

    // Retrying the same submission must not create a duplicate.
    const replay = await alice.post(`/api/groups/${groupId}/expenses`).set(H).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.expense.id).toBe(firstExpenseId);
    expect(await prisma.expense.count({ where: { groupId } })).toBe(1);

    const balances = await alice.get(`/api/groups/${groupId}/balances`);
    expect(net(balances.body.balances, ids.alice)).toBe(20000);
    expect(net(balances.body.balances, ids.bob)).toBe(-10000);
    expect(net(balances.body.balances, ids.chen)).toBe(-10000);
  });

  it('rejects invalid splits on the server', async () => {
    const res = await alice
      .post(`/api/groups/${groupId}/expenses`)
      .set(H)
      .send({
        clientRequestId: uuid(),
        title: 'Bad split',
        amountMinor: 1000,
        currency: 'INR',
        date: today,
        category: 'food',
        payers: [{ memberId: ids.alice, amountMinor: 1000 }],
        split: { method: 'EXACT', participants: [{ memberId: ids.alice, value: 500 }, { memberId: ids.bob, value: 499 }] },
      });
    expect(res.status).toBe(400);
    const negative = await alice
      .post(`/api/groups/${groupId}/expenses`)
      .set(H)
      .send({ clientRequestId: uuid(), title: 'Neg', amountMinor: -5, currency: 'INR', date: today, category: 'food', payers: [], split: { method: 'EQUAL', participants: [] } });
    expect(negative.status).toBe(400);
  });

  it('supports multiple payers and an exact split', async () => {
    const res = await alice
      .post(`/api/groups/${groupId}/expenses`)
      .set(H)
      .send({
        clientRequestId: uuid(),
        title: 'Scooter rental',
        amountMinor: 400000,
        currency: 'INR',
        date: today,
        category: 'transport',
        payers: [
          { memberId: ids.alice, amountMinor: 300000 },
          { memberId: ids.bob, amountMinor: 100000 },
        ],
        split: {
          method: 'EXACT',
          participants: [
            { memberId: ids.alice, value: 100000 },
            { memberId: ids.bob, value: 200000 },
            { memberId: ids.chen, value: 100000 },
          ],
        },
      });
    expect(res.status).toBe(201);
    const balances = await alice.get(`/api/groups/${groupId}/balances`);
    // Alice: +20000 + (300000 − 100000) = 220000; Bob: −10000 + (100000 − 200000) = −110000; Chen: −10000 − 100000
    expect(net(balances.body.balances, ids.alice)).toBe(220000);
    expect(net(balances.body.balances, ids.bob)).toBe(-110000);
    expect(net(balances.body.balances, ids.chen)).toBe(-110000);
    expect(balances.body.suggestions).toHaveLength(2);
  });

  it('records a partial settlement idempotently, then reverses it', async () => {
    const body = { clientRequestId: uuid(), fromMemberId: ids.bob, toMemberId: ids.alice, amountMinor: 50000, method: 'UPI', date: today };
    const first = await alice.post(`/api/groups/${groupId}/settlements`).set(H).send(body);
    expect(first.status).toBe(201);
    const dup = await alice.post(`/api/groups/${groupId}/settlements`).set(H).send(body);
    expect(dup.body.replayed).toBe(true);
    expect(await prisma.settlement.count({ where: { groupId } })).toBe(1);

    let balances = await alice.get(`/api/groups/${groupId}/balances`);
    expect(net(balances.body.balances, ids.bob)).toBe(-60000);
    expect(net(balances.body.balances, ids.alice)).toBe(170000);

    const rev = await alice.post(`/api/groups/${groupId}/settlements/${first.body.settlement.id}/reverse`).set(H).send({ reason: 'Recorded twice' });
    expect(rev.status).toBe(200);
    expect(rev.body.settlement.status).toBe('REVERSED');
    balances = await alice.get(`/api/groups/${groupId}/balances`);
    expect(net(balances.body.balances, ids.bob)).toBe(-110000);
    const again = await alice.post(`/api/groups/${groupId}/settlements/${first.body.settlement.id}/reverse`).set(H).send({ reason: 'x' });
    expect(again.status).toBe(409);
  });

  it('detects conflicting edits and keeps a revision history', async () => {
    const current = await alice.get(`/api/groups/${groupId}/expenses/${firstExpenseId}`);
    const e = current.body.expense;
    const payload = {
      clientRequestId: uuid(),
      title: 'Beach shack dinner (edited)',
      amountMinor: 30000,
      currency: 'INR',
      date: e.date,
      category: 'food',
      payers: [{ memberId: ids.alice, amountMinor: 30000 }],
      split: { method: 'EQUAL', participants: [{ memberId: ids.alice }, { memberId: ids.bob }, { memberId: ids.chen }] },
      expectedVersion: e.version,
    };
    const ok = await alice.put(`/api/groups/${groupId}/expenses/${firstExpenseId}`).set(H).send(payload);
    expect(ok.status).toBe(200);
    expect(ok.body.expense.version).toBe(e.version + 1);
    const stale = await alice.put(`/api/groups/${groupId}/expenses/${firstExpenseId}`).set(H).send(payload);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('EDIT_CONFLICT');
    const detail = await alice.get(`/api/groups/${groupId}/expenses/${firstExpenseId}`);
    expect(detail.body.expense.revisions.map((r: { action: string }) => r.action)).toEqual(['UPDATED', 'CREATED']);
    const balances = await alice.get(`/api/groups/${groupId}/balances`);
    expect(balances.body.balances.reduce((a: number, b: { netMinor: number }) => a + b.netMinor, 0)).toBe(0);
    // Paid and share both dropped by one paisa, so the net position is unchanged.
    expect(net(balances.body.balances, ids.alice)).toBe(220000);
  });

  it('soft-deletes and restores expenses without double counting', async () => {
    const before = (await alice.get(`/api/groups/${groupId}/balances`)).body;
    expect((await alice.delete(`/api/groups/${groupId}/expenses/${firstExpenseId}`).set(H)).status).toBe(200);
    const during = (await alice.get(`/api/groups/${groupId}/balances`)).body;
    expect(net(during.balances, ids.bob)).toBe(net(before.balances, ids.bob)! + 10000);
    expect((await alice.post(`/api/groups/${groupId}/expenses/${firstExpenseId}/restore`).set(H)).status).toBe(200);
    const after = (await alice.get(`/api/groups/${groupId}/balances`)).body;
    expect(after.balances).toEqual(before.balances);
  });

  it('never lets a non-member read or modify the group', async () => {
    expect((await mallory.get(`/api/groups/${groupId}`)).status).toBe(404);
    expect((await mallory.get(`/api/groups/${groupId}/expenses`)).status).toBe(404);
    expect((await mallory.get(`/api/groups/${groupId}/expenses/${firstExpenseId}`)).status).toBe(404);
    expect((await mallory.get(`/api/groups/${groupId}/balances`)).status).toBe(404);
    expect((await mallory.get(`/api/groups/${groupId}/export/backup.json`)).status).toBe(404);
    expect((await mallory.get(`/api/groups/${groupId}/expenses/export.csv`)).status).toBe(404);
    expect((await mallory.get(`/api/expenses?groupId=${groupId}`)).status).toBe(404);
    expect((await mallory.get(`/api/reports?groupId=${groupId}`)).status).toBe(404);
    const search = await mallory.get('/api/search?q=Goa');
    expect(search.body.results.groups).toHaveLength(0);
    const post = await mallory
      .post(`/api/groups/${groupId}/settlements`)
      .set(H)
      .send({ clientRequestId: uuid(), fromMemberId: ids.bob, toMemberId: ids.alice, amountMinor: 1, method: 'CASH', date: today });
    expect(post.status).toBe(404);
    // Mallory cannot use Chen's invitation link either.
    const token = chenInviteUrl.split('/invite/')[1];
    expect((await mallory.post(`/api/invitations/token/${token}/accept`).set(H)).status).toBe(403);
  });

  it('lets the invited user claim their placeholder member and see their balance', async () => {
    const chen = await register('Chen Li', email('chen'));
    const token = chenInviteUrl.split('/invite/')[1];
    const preview = await chen.get(`/api/invitations/token/${token}`);
    expect(preview.body.invitation.groupName).toBe('Goa Trip');
    expect((await chen.post(`/api/invitations/token/${token}/accept`).set(H)).status).toBe(200);
    const detail = await chen.get(`/api/groups/${groupId}`);
    expect(detail.body.myMemberId).toBe(ids.chen);
    const reuse = await chen.post(`/api/invitations/token/${token}/accept`).set(H);
    expect(reuse.status).toBe(409);
  });

  it('enforces viewer permissions on the server', async () => {
    const viewer = await register('Vera', email('vera'));
    const inv = await alice.post(`/api/groups/${groupId}/invitations`).set(H).send({ email: email('vera'), role: 'VIEWER' });
    expect(inv.status).toBe(201);
    const pending = await viewer.get('/api/invitations/mine');
    expect(pending.body.invitations).toHaveLength(1);
    expect((await viewer.post(`/api/invitations/${pending.body.invitations[0].id}/accept`).set(H)).status).toBe(200);
    expect((await viewer.get(`/api/groups/${groupId}/balances`)).status).toBe(200);
    const write = await viewer
      .post(`/api/groups/${groupId}/expenses`)
      .set(H)
      .send({ clientRequestId: uuid(), title: 'x', amountMinor: 100, currency: 'INR', date: today, category: 'food', payers: [{ memberId: ids.alice, amountMinor: 100 }], split: { method: 'EQUAL', participants: [{ memberId: ids.alice }] } });
    expect(write.status).toBe(403);
  });

  it('warns once when the budget threshold is crossed and ignores settlements in budget spending', async () => {
    expect((await alice.put(`/api/groups/${groupId}/budget`).set(H).send({ totalMinor: 500000, warningThresholdPct: 80 })).status).toBe(200);
    const budget = await alice.get(`/api/groups/${groupId}/budget`);
    expect(budget.body.status.spentMinor).toBe(430000);
    expect(budget.body.status.state).toBe('APPROACHING');
    const notes = await prisma.notification.count({ where: { groupId, type: 'BUDGET_WARNING' } });
    expect(notes).toBeGreaterThan(0);
    await alice.post(`/api/groups/${groupId}/settlements`).set(H).send({ clientRequestId: uuid(), fromMemberId: ids.chen, toMemberId: ids.alice, amountMinor: 10000, method: 'CASH', date: today });
    const after = await alice.get(`/api/groups/${groupId}/budget`);
    expect(after.body.status.spentMinor).toBe(430000);
  });

  it('links expenses to plans and reports plan spending once', async () => {
    const plan = await alice.post(`/api/groups/${groupId}/plans`).set(H).send({ title: 'Day trip', type: 'OUTING', startDate: today, participantIds: [ids.alice, ids.bob] });
    expect(plan.status).toBe(201);
    const planId = plan.body.plan.id;
    await alice.post(`/api/groups/${groupId}/expenses`).set(H).send({
      clientRequestId: uuid(),
      title: 'Ferry tickets',
      amountMinor: 20000,
      currency: 'INR',
      date: today,
      category: 'tickets',
      planId,
      payers: [{ memberId: ids.bob, amountMinor: 20000 }],
      split: { method: 'SHARES', participants: [{ memberId: ids.alice, value: 100 }, { memberId: ids.bob, value: 300 }] },
    });
    const detail = await alice.get(`/api/groups/${groupId}/plans/${planId}`);
    expect(detail.body.plan.actualSpendingMinor).toBe(20000);
    expect(detail.body.plan.expenses).toHaveLength(1);
    const report = await alice.get(`/api/reports?groupId=${groupId}`);
    expect(report.body.byPlan).toEqual([expect.objectContaining({ planId, actualMinor: 20000, count: 1 })]);
    expect(report.body.totals.spendingMinor).toBe(450000);
    const csv = await alice.get(`/api/groups/${groupId}/expenses/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Ferry tickets');
    expect(csv.headers['content-type']).toContain('text/csv');
  });

  it('rejects receipts that are not real images or PDFs', async () => {
    const fake = await alice
      .post(`/api/groups/${groupId}/expenses/${firstExpenseId}/attachments`)
      .set(H)
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'receipt.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const pdf = await alice
      .post(`/api/groups/${groupId}/expenses/${firstExpenseId}/attachments`)
      .set(H)
      .attach('file', Buffer.from('%PDF-1.4\n%fake but valid header\n'), { filename: 'bill.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(201);
    expect((await mallory.get(`/api/attachments/${pdf.body.attachment.id}`)).status).toBe(404);
    const own = await alice.get(`/api/attachments/${pdf.body.attachment.id}`);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
  });

  it('prevents removing a member who still has an outstanding balance', async () => {
    const res = await alice.delete(`/api/groups/${groupId}/members/${ids.bob}`).set(H);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UNSETTLED');
  });

  it('runs polls with one vote per member', async () => {
    const created = await alice.post(`/api/groups/${groupId}/polls`).set(H).send({ question: 'Which beach?', options: ['Anjuna', 'Palolem'] });
    expect(created.status).toBe(201);
    let polls = (await alice.get(`/api/groups/${groupId}/polls`)).body.polls;
    const poll = polls[0];
    await alice.post(`/api/groups/${groupId}/polls/${poll.id}/vote`).set(H).send({ optionId: poll.options[0].id });
    await alice.post(`/api/groups/${groupId}/polls/${poll.id}/vote`).set(H).send({ optionId: poll.options[1].id });
    polls = (await alice.get(`/api/groups/${groupId}/polls`)).body.polls;
    expect(polls[0].totalVotes).toBe(1);
    expect(polls[0].myVote).toBe(poll.options[1].id);
    expect((await alice.post(`/api/groups/${groupId}/polls/${poll.id}/close`).set(H)).status).toBe(200);
    expect((await alice.post(`/api/groups/${groupId}/polls/${poll.id}/vote`).set(H).send({ optionId: poll.options[0].id })).status).toBe(409);
    const activity = await alice.get(`/api/groups/${groupId}/activity`);
    expect(activity.body.items.some((a: { type: string }) => a.type === 'POLL_CLOSED')).toBe(true);
  });

  it('builds a dashboard with outstanding balances separate from spending', async () => {
    const res = await alice.get('/api/dashboard');
    expect(res.status).toBe(200);
    const inr = res.body.totals.find((t: { currency: string }) => t.currency === 'INR');
    const balances = (await alice.get(`/api/groups/${groupId}/balances`)).body;
    expect(inr.owedMinor).toBe(net(balances.balances, ids.alice));
    expect(inr.oweMinor).toBe(0);
    expect(inr.groupSpendingMinor).toBe(450000);
    expect(inr.paidMinor).toBe(330000);
  });
});
