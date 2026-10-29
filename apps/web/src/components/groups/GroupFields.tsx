import { useState } from 'react';
import { Box, Button, ButtonBase, IconButton, Stack, TextField, Tooltip, Typography, Alert } from '@mui/material';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { GROUP_TYPES, GROUP_TYPE_LABELS, type GroupType } from '@sharespace/core';
import { GroupTypeIcon } from '../common/Indicators';
import type { CreatedInvite } from '../../api/types';

export interface MemberDraft {
  displayName: string;
  email: string;
}

const TYPE_HINTS: Record<GroupType, string> = {
  TRIP: 'Travel with friends',
  HOME: 'Rent, bills and groceries',
  DINNER: 'One-off meals and outings',
  FAMILY: 'Family costs and occasions',
  OFFICE: 'Team lunches and events',
  GENERAL: 'Anything else',
};

export function GroupTypePicker({ value, onChange }: { value: GroupType; onChange: (t: GroupType) => void }) {
  return (
    <Box role="radiogroup" aria-label="Group type" sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' } }}>
      {GROUP_TYPES.map((t) => {
        const selected = value === t;
        return (
          <ButtonBase
            key={t}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(t)}
            sx={{
              p: 1.5,
              borderRadius: 2.5,
              border: 1.5,
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? 'surface.sage' : 'background.paper',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 0.5,
              minHeight: 76,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: selected ? 'primary.main' : 'text.secondary' }}>
              <GroupTypeIcon type={t} />
              {selected && <Check size={16} aria-hidden />}
            </Stack>
            <Typography variant="body2" sx={{ fontWeight: 650 }}>
              {GROUP_TYPE_LABELS[t]}
            </Typography>
            <Typography variant="caption">{TYPE_HINTS[t]}</Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/** Editable list of people to add. Names are required; email is optional and creates an invitation. */
export function MemberDraftEditor({ value, onChange, ownEmail }: { value: MemberDraft[]; onChange: (v: MemberDraft[]) => void; ownEmail?: string }) {
  const update = (i: number, patch: Partial<MemberDraft>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <Stack spacing={1.25}>
      {value.map((m, i) => {
        const emailInvalid = m.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email.trim());
        const isSelf = ownEmail && m.email.trim().toLowerCase() === ownEmail.toLowerCase();
        return (
          <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
            <TextField label={`Person ${i + 1} name`} value={m.displayName} onChange={(e) => update(i, { displayName: e.target.value })} slotProps={{ htmlInput: { maxLength: 60 } }} />
            <Stack direction="row" spacing={1} sx={{ flex: 1 }} alignItems="flex-start">
              <TextField
                label="Email (optional)"
                type="email"
                value={m.email}
                onChange={(e) => update(i, { email: e.target.value })}
                error={emailInvalid || !!isSelf}
                helperText={emailInvalid ? 'Enter a valid email' : isSelf ? 'That is your own email' : undefined}
              />
              <IconButton aria-label={`Remove person ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))} sx={{ mt: 0.25 }}>
                <Trash2 size={18} />
              </IconButton>
            </Stack>
          </Stack>
        );
      })}
      <Button startIcon={<Plus size={18} />} onClick={() => onChange([...value, { displayName: '', email: '' }])} sx={{ alignSelf: 'flex-start' }} disabled={value.length >= 50}>
        Add person
      </Button>
      <Typography variant="caption">
        People you add can be included in expenses right away. Adding an email also creates an invitation link so they can join with their own account.
      </Typography>
    </Stack>
  );
}

export function draftsValid(drafts: MemberDraft[], ownEmail?: string): boolean {
  return drafts.every((m) => {
    const email = m.email.trim();
    if (m.displayName.trim() === '') return false;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
    if (email && ownEmail && email.toLowerCase() === ownEmail.toLowerCase()) return false;
    return true;
  });
}

export function cleanDrafts(drafts: MemberDraft[]) {
  return drafts
    .filter((m) => m.displayName.trim())
    .map((m) => ({ displayName: m.displayName.trim(), ...(m.email.trim() ? { email: m.email.trim() } : {}) }));
}

export function CopyButton({ text, label = 'Copy link' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip title={copied ? 'Copied' : label}>
      <IconButton
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={18} /> : <Copy size={18} />}
      </IconButton>
    </Tooltip>
  );
}

/** Invitation links are shown once (only a hash is stored). Email delivery is not configured, so the user shares them. */
export function InviteLinks({ invites }: { invites: CreatedInvite[] }) {
  if (invites.length === 0) return null;
  return (
    <Stack spacing={1.25}>
      <Alert severity="info">
        Share these invitation links yourself. ShareSpace does not send emails in this version. Each link works only for the invited email address and
        expires in 7 days.
      </Alert>
      {invites.map((inv) => (
        <Stack key={inv.inviteUrl} direction="row" spacing={1} alignItems="center" sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 2.5, minWidth: 0 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>
              {inv.displayName} · {inv.email}
            </Typography>
            <Typography variant="caption" noWrap component="p" sx={{ fontFamily: 'monospace' }}>
              {inv.inviteUrl}
            </Typography>
          </Box>
          <CopyButton text={inv.inviteUrl} label={`Copy invitation link for ${inv.displayName}`} />
        </Stack>
      ))}
    </Stack>
  );
}
