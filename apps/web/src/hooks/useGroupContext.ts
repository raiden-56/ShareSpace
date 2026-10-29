import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { can, categoryLabel, DEFAULT_CATEGORIES, type Permission } from '@sharespace/core';
import { useGroupQuery } from '../api/api';
import type { GroupDetail, Member } from '../api/types';

export interface GroupHelpers {
  data: GroupDetail;
  memberById: Map<string, Member>;
  memberName: (id: string | null | undefined) => string;
  /** Members currently in the group (excludes people who left or were removed). */
  activeMembers: Member[];
  categories: { id: string; label: string }[];
  categoryName: (id: string) => string;
  can: (permission: Permission) => boolean;
  /** Group member id of the signed-in user. */
  me: string;
  /** Resolves a user id (createdById etc.) to that user's display name in this group. */
  userName: (userId: string | null | undefined) => string;
  isArchived: boolean;
}

export function buildGroupHelpers(data: GroupDetail): GroupHelpers {
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const userNames = new Map(data.members.filter((m) => m.userId).map((m) => [m.userId!, m.displayName]));
  const custom = data.categories;
  return {
    data,
    memberById,
    memberName: (id) => (id ? (memberById.get(id)?.displayName ?? 'Former member') : ''),
    activeMembers: data.members.filter((m) => m.status === 'ACTIVE'),
    categories: [...DEFAULT_CATEGORIES, ...custom],
    categoryName: (id) => categoryLabel(id, custom),
    can: (permission) => !data.group.archivedAt && can(data.role, permission),
    me: data.myMemberId,
    userName: (userId) => {
      if (!userId) return 'Someone';
      return userNames.get(userId) ?? 'A former member';
    },
    isArchived: !!data.group.archivedAt,
  };
}

/** Group detail for the `:groupId` route param, plus lookup helpers. */
export function useGroupContext(groupIdOverride?: string) {
  const params = useParams();
  const groupId = groupIdOverride ?? params.groupId ?? '';
  const query = useGroupQuery(groupId, { skip: !groupId });
  const helpers = useMemo(() => (query.data ? buildGroupHelpers(query.data) : null), [query.data]);
  return { groupId, ...query, helpers };
}
