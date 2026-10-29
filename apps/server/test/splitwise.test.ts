import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dueOccurrences } from '@sharespace/core';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

const app = createApp();
const H = { 'X-Requested-With': 'ShareSpace' };
const uuid = () => crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
const run = crypto.randomBytes(4).toString('hex');
const email = (name: string) => `${name}-${run}@example.com`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

type Agent = ReturnType<typeof request.agent>;

async function register(name: string): Promise<{ agent: Agent; id: string }> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').set(H).send({ name, email: email(name.toLowerCase()), password: 'correct-horse-9' });
  expect(res.status).toBe(201);
  return { agent, id: res.body.user.id };
}

/** Alice creates a group with Bob invited by email; Bob accepts. Returns both member ids. */
async function sharedGroup(alice: Agent, bob: Agent, name: string, extra: { displayName: string }[] = []) {
  const res = await alice
    .post('/api/groups')
    .set(H)
    .send({ name, type: 'HOME', currency: 'INR', members: [{ displayName: 'Bob', email: email('bob') }, ...extra] });
  expect(res.status).toBe(201);
  const token = res.body.invitations[0].inviteUrl.split('/').pop();
  expect((await bob.post(`/api/invitations/token/${token}/accept`).set(H)).status).toBe(200);
  const detail = await alice.get(`/api/groups/${res.body.group.id}`);
  const id = (n: string) => detail.body.members.find((m: { displayName: string }) => m.displayName === n).id as string;
  return { groupId: res.body.group.id as string, alice: id('Alice'), bob: id('Bob'), others: extra.map((e) => id(e.displayName)) };
}

function expense(title: string, amountMinor: number, payer: string, split: object, extra: object = {}) {
  return { clientRequestId: uuid(), title, amountMinor, currency: 'INR', date: today, category: 'food', payers: [{ memberId: payer, amountMinor }], split, ...extra };
}

describe('Splitwise-style features', () => {
  let alice: Agent;
  let bob: Agent;
  let bobKey: string;
  let flat: Awaited<ReturnType<typeof sharedGroup>>;
  let trip: Awaited<ReturnType<typeof sharedGroup>>;

  beforeAll(async () => {
    const a = await register('Alice');
    const b = await register('Bob');
    alice = a.agent;
    bob = b.agent;
    bobKey = `u.${b.id}`;
    flat = await sharedGroup(alice, bob, 'Flat');
    trip = await sharedGroup(alice, bob, 'Trip', [{ displayName: 'Chen' }]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('nets expenses paid by different people into one repayment', async () => {
    // Alice pays ₹200 for both, Bob pays ₹100 for both: Bob owes Alice ₹50.
    const both = { method: 'EQUAL', participants: [{ memberId: flat.alice }, { memberId: flat.bob }] };
    expect((await alice.post(`/api/groups/${flat.groupId}/expenses`).set(H).send(expense('Groceries', 20000, flat.alice, both))).status).toBe(201);
    expect((await bob.post(`/api/groups/${flat.groupId}/expenses`).set(H).send(expense('Snacks', 10000, flat.bob, both))).status).toBe(201);
    const balances = await alice.get(`/api/groups/${flat.groupId}/balances`);
    expect(balances.body.suggestions).toEqual([{ fromMemberId: flat.bob, toMemberId: flat.alice, amountMinor: 5000 }]);
  });

  it('totals one friend across groups', async () => {
    // In the trip, Bob pays ₹300 that is all Alice's: across both groups Alice owes Bob ₹250.
    const res = await bob
      .post(`/api/groups/${trip.groupId}/expenses`)
      .set(H)
      .send(expense('Hotel', 30000, trip.bob, { method: 'EXACT', participants: [{ memberId: trip.alice, value: 30000 }] }));
    expect(res.status).toBe(201);
    const friends = await alice.get('/api/friends');
    const friend = friends.body.friends.find((f: { key: string }) => f.key === bobKey);
    expect(friend.balances).toEqual([{ currency: 'INR', netMinor: -25000 }]);
    expect(friend.groups.map((g: { groupName: string; netMinor: number }) => [g.groupName, g.netMinor])).toEqual([
      ['Trip', -30000],
      ['Flat', 5000],
    ]);
    // Chen was added by name only and appears as a friend scoped to the trip.
    expect(friends.body.friends.some((f: { name: string; isPlaceholder: boolean }) => f.name === 'Chen' && f.isPlaceholder)).toBe(true);
    // Bob sees the mirror image.
    const mirror = await bob.get('/api/friends');
    expect(mirror.body.friends.find((f: { name: string }) => f.name === 'Alice').balances).toEqual([{ currency: 'INR', netMinor: 25000 }]);
  });

  it('shows shared expenses on the friend page and hides strangers', async () => {
    const res = await alice.get(`/api/friends/${encodeURIComponent(bobKey)}`);
    expect(res.status).toBe(200);
    expect(res.body.expenses.map((e: { title: string }) => e.title).sort()).toEqual(['Groceries', 'Hotel', 'Snacks']);
    const stranger = await register('Mallory');
    expect((await stranger.agent.get(`/api/friends/${encodeURIComponent(bobKey)}`)).status).toBe(404);
  });

  it('rejects settling more than the net balance', async () => {
    const res = await alice
      .post(`/api/friends/${encodeURIComponent(bobKey)}/settle`)
      .set(H)
      .send({ clientRequestId: uuid(), currency: 'INR', amountMinor: 25001, method: 'CASH', date: today });
    expect(res.status).toBe(400);
  });

  it('settles up across groups in one step, idempotently', async () => {
    const body = { clientRequestId: uuid(), currency: 'INR', amountMinor: 25000, method: 'UPI', date: today };
    const res = await alice.post(`/api/friends/${encodeURIComponent(bobKey)}/settle`).set(H).send(body);
    expect(res.status).toBe(201);
    // Alice pays ₹300 in the trip and Bob's ₹50 in the flat is offset, so every group is clear.
    const legs = res.body.settlements.map((s: { groupId: string; fromMemberId: string; amountMinor: number }) => [s.groupId, s.fromMemberId, s.amountMinor]);
    expect(legs).toEqual(
      expect.arrayContaining([
        [trip.groupId, trip.alice, 30000],
        [flat.groupId, flat.bob, 5000],
      ]),
    );
    const retry = await alice.post(`/api/friends/${encodeURIComponent(bobKey)}/settle`).set(H).send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    const friends = await alice.get('/api/friends');
    expect(friends.body.friends.find((f: { key: string }) => f.key === bobKey).balances).toEqual([]);
    for (const g of [flat.groupId, trip.groupId]) {
      const b = await alice.get(`/api/groups/${g}/balances`);
      expect(b.body.balances.every((x: { netMinor: number }) => x.netMinor === 0)).toBe(true);
    }
  });

  it('applies a partial settle-up to the largest debt first', async () => {
    const solo = (g: typeof flat, amount: number) => expense('Tickets', amount, g.alice, { method: 'EXACT', participants: [{ memberId: g.bob, value: amount }] });
    await alice.post(`/api/groups/${flat.groupId}/expenses`).set(H).send(solo(flat, 4000));
    await alice.post(`/api/groups/${trip.groupId}/expenses`).set(H).send(solo(trip, 9000));
    const res = await bob
      .post(`/api/friends/${encodeURIComponent(`u.${(await alice.get('/api/auth/me')).body.user.id}`)}/settle`)
      .set(H)
      .send({ clientRequestId: uuid(), currency: 'INR', amountMinor: 10000, method: 'CASH', date: today });
    expect(res.status).toBe(201);
    expect(res.body.settlements.map((s: { groupId: string; amountMinor: number }) => [s.groupId, s.amountMinor])).toEqual([
      [trip.groupId, 9000],
      [flat.groupId, 1000],
    ]);
  });

  it('sends one payment reminder per day to a friend who owes you', async () => {
    const first = await alice.post(`/api/friends/${encodeURIComponent(bobKey)}/remind`).set(H);
    expect(first.status).toBe(200);
    const second = await alice.post(`/api/friends/${encodeURIComponent(bobKey)}/remind`).set(H);
    expect(second.status).toBe(409);
    const notes = await bob.get('/api/notifications');
    expect(notes.body.items.some((n: { type: string; body: string }) => n.type === 'PAYMENT_REMINDER' && n.body.includes('₹30.00'))).toBe(true);
    // Bob owes Alice, so Bob cannot remind Alice.
    const meId = (await alice.get('/api/auth/me')).body.user.id;
    expect((await bob.post(`/api/friends/${encodeURIComponent(`u.${meId}`)}/remind`).set(H)).status).toBe(409);
  });

  it('keeps each debt between its two people when simplify debts is off', async () => {
    // Trip: Chen owes Alice, and Bob paid for Chen. Simplified, one payment covers it; pairwise keeps both.
    const g = trip;
    const settle = await alice.get(`/api/groups/${g.groupId}/balances`);
    for (const t of settle.body.suggestions) {
      await alice.post(`/api/groups/${g.groupId}/settlements`).set(H).send({ clientRequestId: uuid(), fromMemberId: t.fromMemberId, toMemberId: t.toMemberId, amountMinor: t.amountMinor, method: 'CASH', date: today });
    }
    const chen = g.others[0]!;
    await alice.post(`/api/groups/${g.groupId}/expenses`).set(H).send(expense('Fuel', 6000, g.alice, { method: 'EXACT', participants: [{ memberId: g.bob, value: 6000 }] }));
    await alice.post(`/api/groups/${g.groupId}/expenses`).set(H).send(expense('Lunch', 6000, g.bob, { method: 'EXACT', participants: [{ memberId: chen, value: 6000 }] }));
    const simplified = await alice.get(`/api/groups/${g.groupId}/balances`);
    expect(simplified.body.simplifyDebts).toBe(true);
    expect(simplified.body.suggestions).toEqual([{ fromMemberId: chen, toMemberId: g.alice, amountMinor: 6000 }]);

    expect((await alice.patch(`/api/groups/${g.groupId}`).set(H).send({ simplifyDebts: false })).status).toBe(200);
    const pairwise = await alice.get(`/api/groups/${g.groupId}/balances`);
    expect(pairwise.body.simplifyDebts).toBe(false);
    expect(pairwise.body.suggestions).toEqual(
      expect.arrayContaining([
        { fromMemberId: g.bob, toMemberId: g.alice, amountMinor: 6000 },
        { fromMemberId: chen, toMemberId: g.bob, amountMinor: 6000 },
      ]),
    );
    expect(pairwise.body.suggestions).toHaveLength(2);
    const activity = await alice.get(`/api/groups/${g.groupId}/activity`);
    expect(JSON.stringify(activity.body)).toContain('turned off simplified debts');
  });

  it('splits by adjustment', async () => {
    const res = await alice
      .post(`/api/groups/${flat.groupId}/expenses`)
      .set(H)
      .send(expense('Pizza', 10000, flat.alice, { method: 'ADJUSTMENT', participants: [{ memberId: flat.alice, value: 0 }, { memberId: flat.bob, value: 2000 }] }));
    expect(res.status).toBe(201);
    expect(res.body.expense.shares.map((s: { amountMinor: number }) => s.amountMinor)).toEqual([4000, 6000]);
    expect(res.body.expense.shares[1].inputValue).toBe(2000);
  });

  it('adds due repeats of a repeating expense exactly once', async () => {
    const start = daysAgo(70);
    const expected = dueOccurrences(start, 'MONTHLY', 0, today).due.length;
    const body = expense('Rent', 50000, flat.alice, { method: 'EQUAL', participants: [{ memberId: flat.alice }, { memberId: flat.bob }] }, { date: start, repeat: 'MONTHLY' });
    const res = await alice.post(`/api/groups/${flat.groupId}/expenses`).set(H).send(body);
    expect(res.status).toBe(201);
    expect(res.body.expense.repeatInterval).toBe('MONTHLY');
    const copies = () => prisma.expense.count({ where: { recurringSourceId: res.body.expense.id } });
    expect(await copies()).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(2);
    // Saving it again without changing the schedule adds nothing new.
    const edit = await alice
      .put(`/api/groups/${flat.groupId}/expenses/${res.body.expense.id}`)
      .set(H)
      .send({ ...body, title: 'Flat rent', expectedVersion: res.body.expense.version });
    expect(edit.status).toBe(200);
    expect(await copies()).toBe(expected);
    const list = await alice.get(`/api/groups/${flat.groupId}/expenses?q=Rent`);
    expect(list.body.items.filter((e: { title: string }) => e.title === 'Rent')).toHaveLength(expected);
    // Stopping the repeat clears the schedule.
    const stop = await alice
      .put(`/api/groups/${flat.groupId}/expenses/${res.body.expense.id}`)
      .set(H)
      .send({ ...body, repeat: 'NONE', expectedVersion: edit.body.expense.version });
    expect(stop.body.expense.repeatNextDate).toBeNull();
  });

  it('keeps expenses outside any group in a private two-person group', async () => {
    const created = await alice.post(`/api/friends/${encodeURIComponent(bobKey)}/direct`).set(H).send({});
    expect(created.status).toBe(201);
    const again = await alice.post(`/api/friends/${encodeURIComponent(bobKey)}/direct`).set(H).send({});
    expect(again.body.groupId).toBe(created.body.groupId);
    const groupId = created.body.groupId;
    const groups = await alice.get('/api/groups');
    expect(groups.body.groups.some((g: { id: string }) => g.id === groupId)).toBe(false);
    expect((await alice.post(`/api/groups/${groupId}/members`).set(H).send({ displayName: 'Eve' })).status).toBe(409);
    const detail = await bob.get(`/api/groups/${groupId}`);
    expect(detail.body.group.isDirect).toBe(true);
    const me = detail.body.myMemberId;
    const alicesId = detail.body.members.find((m: { id: string }) => m.id !== me).id;
    await bob.post(`/api/groups/${groupId}/expenses`).set(H).send(expense('Coffee', 800, me, { method: 'EQUAL', participants: [{ memberId: me }, { memberId: alicesId }] }));
    const friend = (await alice.get('/api/friends')).body.friends.find((f: { key: string }) => f.key === bobKey);
    expect(friend.directGroupId).toBe(groupId);
    expect(friend.groups.find((g: { groupId: string }) => g.groupId === groupId).netMinor).toBe(-400);
  });

  it('only offers expenses outside groups with friends who have an account', async () => {
    const chen = (await alice.get('/api/friends')).body.friends.find((f: { name: string }) => f.name === 'Chen');
    expect((await alice.post(`/api/friends/${encodeURIComponent(chen.key)}/direct`).set(H).send({})).status).toBe(409);
  });
});
