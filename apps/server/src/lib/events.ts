import type { Prisma } from '@prisma/client';
import {
  DEFAULT_PREFERENCES,
  notificationPrefKey,
  preferencesSchema,
  type NotificationType,
  type Preferences,
} from '@sharespace/core';
import { prisma, type Tx } from '../db';

export async function getPreferences(userId: string, db: Tx | typeof prisma = prisma): Promise<Preferences> {
  const row = await db.userPreference.findUnique({ where: { userId } });
  const parsed = preferencesSchema.partial().safeParse(row?.data ?? {});
  const data = parsed.success ? parsed.data : {};
  return { ...DEFAULT_PREFERENCES, ...data, notifications: { ...DEFAULT_PREFERENCES.notifications, ...(data.notifications ?? {}) } };
}

export interface ActivityInput {
  groupId: string;
  actorUserId: string | null;
  actorName: string;
  type: string;
  entityType: string;
  entityId?: string | null;
  planId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}

export async function logActivity(db: Tx | typeof prisma, input: ActivityInput): Promise<void> {
  await db.activityLog.create({
    data: {
      groupId: input.groupId,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      planId: input.planId ?? null,
      summary: input.summary,
      metadata: input.metadata,
    },
  });
}

export interface NotifyInput {
  groupId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  /** Users who should not receive it (usually the actor). */
  excludeUserIds?: string[];
  /** Restrict to these users; defaults to every active member with an account. */
  onlyUserIds?: string[];
  dedupeKey?: string;
}

/**
 * Creates in-app notifications for group members, honouring each user's notification preferences.
 * Only in-app notifications exist: no email or push is sent or claimed.
 */
export async function notifyGroup(db: Tx | typeof prisma, input: NotifyInput): Promise<void> {
  const members = await db.groupMember.findMany({
    where: { groupId: input.groupId, status: 'ACTIVE', userId: { not: null } },
    select: { userId: true },
  });
  const exclude = new Set(input.excludeUserIds ?? []);
  const only = input.onlyUserIds ? new Set(input.onlyUserIds) : null;
  const prefKey = notificationPrefKey(input.type);
  const recipients: string[] = [];
  for (const m of members) {
    const userId = m.userId!;
    if (exclude.has(userId) || (only && !only.has(userId))) continue;
    if (prefKey) {
      const prefs = await getPreferences(userId, db);
      if (!prefs.notifications[prefKey]) continue;
    }
    recipients.push(userId);
  }
  if (recipients.length === 0) return;
  await db.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      groupId: input.groupId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
}

export async function notifyUser(
  db: Tx | typeof prisma,
  userId: string,
  input: Omit<NotifyInput, 'excludeUserIds' | 'onlyUserIds' | 'groupId'> & { groupId?: string | null },
): Promise<void> {
  const prefKey = notificationPrefKey(input.type);
  if (prefKey) {
    const prefs = await getPreferences(userId, db);
    if (!prefs.notifications[prefKey]) return;
  }
  await db.notification.createMany({
    data: [
      {
        userId,
        groupId: input.groupId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
    ],
    skipDuplicates: true,
  });
}
