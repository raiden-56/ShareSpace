import type { Request } from 'express';
import type { Group, GroupMember } from '@prisma/client';
import { can, type Permission } from '@sharespace/core';
import { prisma } from '../db';
import { conflict, forbidden, notFound, param } from './http';
import { currentUser } from './auth';

export interface GroupAccess {
  group: Group;
  member: GroupMember;
}

/**
 * Resolves the caller's active membership for `:groupId` and checks a permission.
 * Non-members get 404 (not 403) so group existence is never revealed to outsiders.
 * Archived groups are read-only unless `allowArchived` is set.
 */
export async function requireGroup(
  req: Request,
  permission: Permission = 'viewGroup',
  opts: { allowArchived?: boolean; groupId?: string } = {},
): Promise<GroupAccess> {
  const user = currentUser(req);
  const groupId = opts.groupId ?? param(req, 'groupId');
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId: user.id, status: 'ACTIVE' },
    include: { group: true },
  });
  if (!member) throw notFound('Group not found');
  if (!can(member.role, permission)) throw forbidden();
  if (member.group.archivedAt && permission !== 'viewGroup' && !opts.allowArchived) {
    throw conflict('This group is archived. Restore it to make changes.', 'ARCHIVED');
  }
  const { group, ...rest } = member;
  return { group, member: rest };
}

/** All group ids the user can currently read. Used to scope global queries (search, dashboard, reports). */
export async function accessibleGroupIds(userId: string, opts: { includeArchived?: boolean } = {}): Promise<string[]> {
  const rows = await prisma.groupMember.findMany({
    where: { userId, status: 'ACTIVE', ...(opts.includeArchived ? {} : { group: { archivedAt: null } }) },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId);
}

/** Ensures every member id belongs to the group (and optionally is active). Prevents cross-group references. */
export async function assertMembersInGroup(groupId: string, memberIds: string[], opts: { allowInactive?: string[] } = {}): Promise<void> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return;
  const rows = await prisma.groupMember.findMany({ where: { groupId, id: { in: unique } }, select: { id: true, status: true } });
  if (rows.length !== unique.length) throw notFound('One or more members do not belong to this group');
  const allowed = new Set(opts.allowInactive ?? []);
  const inactive = rows.find((r) => r.status !== 'ACTIVE' && !allowed.has(r.id));
  if (inactive) throw conflict('One or more selected members are no longer in this group');
}
