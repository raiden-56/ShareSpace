/**
 * Optional demo data for local development. Creates a clearly labelled demo account
 * (demo@sharespace.local / demo-password-1) with one group, expenses, a repayment and a plan.
 * It goes through the real API so every amount is produced by the same split engine.
 * Safe to run repeatedly: it does nothing if the demo account already exists.
 */
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

const H = { 'X-Requested-With': 'ShareSpace' };
const DEMO = { name: 'Demo User', email: 'demo@sharespace.local', password: 'demo-password-1' };

async function main() {
  if (await prisma.user.findUnique({ where: { email: DEMO.email } })) {
    console.log(`Demo account already exists: ${DEMO.email}`);
    return;
  }
  const agent = request.agent(createApp());
  const ok = (res: request.Response, status = 201) => {
    if (res.status !== status) throw new Error(`Seed request failed (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body;
  };
  ok(await agent.post('/api/auth/register').set(H).send(DEMO));
  await agent.patch('/api/me/preferences').set(H).send({ onboardingCompleted: true });

  const { group } = ok(
    await agent.post('/api/groups').set(H).send({
      name: 'Goa Weekend (demo)',
      type: 'TRIP',
      currency: 'INR',
      description: 'Demo data created by the seed script',
      members: [{ displayName: 'Arjun' }, { displayName: 'Meera' }],
      budgetMinor: 2_500_000,
    }),
  );
  const detail = ok(await agent.get(`/api/groups/${group.id}`), 200);
  const [me, arjun, meera] = detail.members.map((m: { id: string }) => m.id) as [string, string, string];
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

  const plan = ok(
    await agent.post(`/api/groups/${group.id}/plans`).set(H).send({
      title: 'Beach day at Palolem',
      type: 'OUTING',
      status: 'CONFIRMED',
      startDate: day(-3),
      location: 'Palolem, Goa',
      estimatedBudgetMinor: 600_000,
      participantIds: [me, arjun, meera],
    }),
  ).plan;

  const expenses = [
    { title: 'Villa booking', amountMinor: 1_200_000, category: 'accommodation', date: day(6), payers: [{ memberId: me, amountMinor: 1_200_000 }], split: { method: 'EQUAL', participants: [{ memberId: me }, { memberId: arjun }, { memberId: meera }] } },
    { title: 'Scooter rental', amountMinor: 240_000, category: 'transport', date: day(5), payers: [{ memberId: arjun, amountMinor: 160_000 }, { memberId: meera, amountMinor: 80_000 }], split: { method: 'SHARES', participants: [{ memberId: me, value: 100 }, { memberId: arjun, value: 200 }, { memberId: meera, value: 100 }] } },
    { title: 'Seafood dinner', amountMinor: 386_500, category: 'food', date: day(4), payers: [{ memberId: meera, amountMinor: 386_500 }], split: { method: 'EXACT', participants: [{ memberId: me, value: 150_000 }, { memberId: arjun, value: 136_500 }, { memberId: meera, value: 100_000 }] } },
    { title: 'Kayak tickets', amountMinor: 180_000, category: 'activities', date: day(1), planId: plan.id, payers: [{ memberId: me, amountMinor: 180_000 }], split: { method: 'EQUAL', participants: [{ memberId: me }, { memberId: arjun }, { memberId: meera }] } },
  ];
  for (const e of expenses) {
    ok(await agent.post(`/api/groups/${group.id}/expenses`).set(H).send({ ...e, clientRequestId: crypto.randomUUID(), currency: 'INR' }));
  }
  ok(
    await agent.post(`/api/groups/${group.id}/settlements`).set(H).send({
      clientRequestId: crypto.randomUUID(),
      fromMemberId: arjun,
      toMemberId: me,
      amountMinor: 200_000,
      method: 'UPI',
      date: day(0),
      notes: 'Partial repayment',
    }),
  );
  console.log(`Demo data created. Sign in with ${DEMO.email} / ${DEMO.password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
