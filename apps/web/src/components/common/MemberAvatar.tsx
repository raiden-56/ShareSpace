import { Avatar, AvatarGroup, Tooltip, type SxProps, type Theme } from '@mui/material';
import { initials } from '../../lib/format';

const AVATAR_COLORS = ['#386641', '#A2674A', '#6B7F5E', '#C96F52', '#8A6A4F', '#4C8157', '#B07A2E', '#5E6B4A'];

function colorFor(name: string, explicit?: string | null): string {
  if (explicit) return explicit;
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

interface MemberAvatarProps {
  name: string;
  color?: string | null;
  size?: number;
  sx?: SxProps<Theme>;
  /** Placeholder members (no account yet) get a dashed outline. */
  placeholder?: boolean;
  tooltip?: boolean;
}

export function MemberAvatar({ name, color, size = 32, sx, placeholder, tooltip }: MemberAvatarProps) {
  const avatar = (
    <Avatar
      alt={name}
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        bgcolor: placeholder ? 'transparent' : colorFor(name, color),
        color: placeholder ? 'text.secondary' : '#fff',
        border: placeholder ? '1.5px dashed' : 'none',
        borderColor: 'text.disabled',
        ...sx,
      }}
    >
      {initials(name)}
    </Avatar>
  );
  return tooltip ? <Tooltip title={name}>{avatar}</Tooltip> : avatar;
}

export function AvatarStack({ members, max = 4, size = 28, total }: { members: { id: string; displayName: string; avatarColor?: string | null }[]; max?: number; size?: number; total?: number }) {
  return (
    <AvatarGroup
      max={max}
      total={total ?? members.length}
      sx={{ justifyContent: 'flex-end', '& .MuiAvatar-root': { width: size, height: size, fontSize: size * 0.38, borderColor: 'background.paper' } }}
      aria-label={`${total ?? members.length} members`}
    >
      {members.map((m) => (
        <MemberAvatar key={m.id} name={m.displayName} color={m.avatarColor} size={size} tooltip />
      ))}
    </AvatarGroup>
  );
}
