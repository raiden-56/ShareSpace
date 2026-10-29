import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Crown, Download, LogOut, Mail, MoreVertical, Pencil, Shield, Trash2, UserPlus } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@sharespace/core';
import {
  toApiError,
  useAddMemberMutation,
  useBalancesQuery,
  useCreateInvitationMutation,
  useGroupInvitationsQuery,
  useLeaveGroupMutation,
  useRemoveMemberMutation,
  useRevokeInvitationMutation,
  useUpdateMemberMutation,
} from '../../api/api';
import type { Member } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { useGroupContext } from '../../hooks/useGroupContext';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';
import { downloadFile } from '../../lib/download';
import { PageTransition, SectionCard } from '../../components/common/Layout';
import { BalanceInline } from '../../components/common/Money';
import { MemberAvatar } from '../../components/common/MemberAvatar';
import { MemberListSkeleton } from '../../components/common/Skeletons';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { CopyButton } from '../../components/groups/GroupFields';

type DialogState =
  | { kind: 'add' }
  | { kind: 'invite'; member?: Member }
  | { kind: 'rename'; member: Member }
  | { kind: 'role'; member: Member }
  | { kind: 'remove'; member: Member }
  | { kind: 'transfer'; member: Member }
  | { kind: 'leave' }
  | { kind: 'link'; url: string; email: string }
  | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function GroupMembers() {
  const { groupId, helpers } = useGroupContext();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormat();
  const balances = useBalancesQuery(groupId);
  const manage = !!helpers?.can('manageMembers');
  const invitations = useGroupInvitationsQuery(groupId, { skip: !manage });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; member: Member } | null>(null);
  const [leave, { isLoading: leaving }] = useLeaveGroupMutation();
  const [remove, { isLoading: removing }] = useRemoveMemberMutation();
  const [updateMember, { isLoading: updating }] = useUpdateMemberMutation();
  const [revoke] = useRevokeInvitationMutation();

  if (!helpers) return <MemberListSkeleton />;
  const role = helpers.data.role;
  const net = new Map(balances.data?.balances.map((b) => [b.memberId, b.netMinor]) ?? []);
  const currency = helpers.data.group.currency;
  const active = helpers.activeMembers;
  const former = helpers.data.members.filter((m) => m.status !== 'ACTIVE');
  const pending = (invitations.data?.invitations ?? []).filter((i) => i.status === 'PENDING');
  const fail = (e: unknown) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' }));

  const canRename = (m: Member) => !helpers.isArchived && (m.isYou || manage);
  const canChangeRole = (m: Member) => role === 'OWNER' && !helpers.isArchived && m.hasAccount && !m.isYou;
  const canRemove = (m: Member) => manage && m.role !== 'OWNER' && !m.isYou && (m.role !== 'ADMIN' || role === 'OWNER');
  const canInvite = (m: Member) => manage && !m.hasAccount;

  return (
    <PageTransition>
      <Stack spacing={2.5}>
        <SectionCard
          title={`Members (${active.length})`}
          subtitle="People with a dashed avatar have not joined with an account yet. They can still be part of expenses."
          action={
            manage && (
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="outlined" startIcon={<Mail size={16} />} onClick={() => setDialog({ kind: 'invite' })}>
                  Invite
                </Button>
                <Button size="small" variant="contained" startIcon={<UserPlus size={16} />} onClick={() => setDialog({ kind: 'add' })}>
                  Add person
                </Button>
              </Stack>
            )
          }
        >
          <Stack divider={<Divider />}>
            {active.map((m) => {
              const hasActions = canRename(m) || canChangeRole(m) || canRemove(m) || canInvite(m);
              return (
                <Stack key={m.id} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.5 }}>
                  <MemberAvatar name={m.displayName} color={m.avatarColor} size={40} placeholder={!m.hasAccount} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" noWrap>
                        {m.displayName}
                        {m.isYou ? ' (you)' : ''}
                      </Typography>
                      {m.hasAccount && (
                        <Chip
                          size="small"
                          icon={m.role === 'OWNER' ? <Crown size={12} /> : m.role === 'ADMIN' ? <Shield size={12} /> : undefined}
                          label={ROLE_LABELS[m.role]}
                          variant="outlined"
                          sx={{ height: 22, '& .MuiChip-icon': { color: 'inherit' } }}
                        />
                      )}
                    </Stack>
                    <Typography variant="caption" noWrap component="p">
                      {m.hasAccount ? (m.email ?? 'Member') : m.email ? `Invited · ${m.email}` : 'Not joined yet'}
                    </Typography>
                  </Box>
                  <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{balances.data && <BalanceInline netMinor={net.get(m.id) ?? 0} currency={currency} you={m.isYou} />}</Box>
                  {hasActions ? (
                    <IconButton aria-label={`Actions for ${m.displayName}`} onClick={(e) => setMenu({ anchor: e.currentTarget, member: m })}>
                      <MoreVertical size={18} />
                    </IconButton>
                  ) : (
                    <Box sx={{ width: 40 }} />
                  )}
                </Stack>
              );
            })}
          </Stack>
        </SectionCard>

        {manage && pending.length > 0 && (
          <SectionCard title="Pending invitations" subtitle="Invitation links expire after 7 days. Revoked links stop working immediately.">
            <Stack divider={<Divider />}>
              {pending.map((inv) => (
                <Stack key={inv.id} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.25 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {inv.email}
                    </Typography>
                    <Typography variant="caption">
                      {ROLE_LABELS[inv.role]} · expires {fmt.date(inv.expiresAt)}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() =>
                      revoke({ groupId, invitationId: inv.id })
                        .unwrap()
                        .then(() => dispatch(showToast({ message: 'Invitation revoked' })))
                        .catch(fail)
                    }
                  >
                    Revoke
                  </Button>
                </Stack>
              ))}
            </Stack>
          </SectionCard>
        )}

        {former.length > 0 && (
          <SectionCard title="Former members" subtitle="Their past expenses and repayments remain in the group history.">
            <Stack spacing={1.25}>
              {former.map((m) => (
                <Stack key={m.id} direction="row" spacing={1.5} alignItems="center">
                  <MemberAvatar name={m.displayName} size={32} placeholder />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {m.displayName}
                  </Typography>
                  <Typography variant="caption">{m.status === 'LEFT' ? 'Left' : 'Removed'}</Typography>
                </Stack>
              ))}
            </Stack>
          </SectionCard>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between">
          <Button
            startIcon={<Download size={16} />}
            onClick={() => downloadFile(`/api/groups/${groupId}/export/members.csv`, 'members.csv').catch((e: Error) => dispatch(showToast({ message: e.message, severity: 'error' })))}
          >
            Export members (CSV)
          </Button>
          <Button color="error" startIcon={<LogOut size={16} />} onClick={() => setDialog({ kind: 'leave' })}>
            Leave group
          </Button>
        </Stack>
      </Stack>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu && canRename(menu.member) && (
          <MenuItem onClick={() => { setDialog({ kind: 'rename', member: menu.member }); setMenu(null); }}>
            <ListItemIcon><Pencil size={16} /></ListItemIcon>
            Rename
          </MenuItem>
        )}
        {menu && canInvite(menu.member) && (
          <MenuItem onClick={() => { setDialog({ kind: 'invite', member: menu.member }); setMenu(null); }}>
            <ListItemIcon><Mail size={16} /></ListItemIcon>
            Invite to join
          </MenuItem>
        )}
        {menu && canChangeRole(menu.member) && (
          <MenuItem onClick={() => { setDialog({ kind: 'role', member: menu.member }); setMenu(null); }}>
            <ListItemIcon><Shield size={16} /></ListItemIcon>
            Change role
          </MenuItem>
        )}
        {menu && canChangeRole(menu.member) && (
          <MenuItem onClick={() => { setDialog({ kind: 'transfer', member: menu.member }); setMenu(null); }}>
            <ListItemIcon><Crown size={16} /></ListItemIcon>
            Make owner
          </MenuItem>
        )}
        {menu && canRemove(menu.member) && (
          <MenuItem onClick={() => { setDialog({ kind: 'remove', member: menu.member }); setMenu(null); }} sx={{ color: 'error.main' }}>
            <ListItemIcon sx={{ color: 'inherit' }}><Trash2 size={16} /></ListItemIcon>
            Remove from group
          </MenuItem>
        )}
      </Menu>

      <AddPersonDialog open={dialog?.kind === 'add'} groupId={groupId} onClose={() => setDialog(null)} onInviteLink={(url, email) => setDialog({ kind: 'link', url, email })} />
      <InviteDialog
        open={dialog?.kind === 'invite'}
        groupId={groupId}
        member={dialog?.kind === 'invite' ? dialog.member : undefined}
        placeholders={active.filter((m) => !m.hasAccount)}
        isOwner={role === 'OWNER'}
        onClose={() => setDialog(null)}
        onCreated={(url, email) => setDialog({ kind: 'link', url, email })}
      />
      <RenameDialog
        member={dialog?.kind === 'rename' ? dialog.member : null}
        busy={updating}
        onClose={() => setDialog(null)}
        onSave={(displayName) =>
          dialog?.kind === 'rename' &&
          updateMember({ groupId, memberId: dialog.member.id, displayName })
            .unwrap()
            .then(() => {
              dispatch(showToast({ message: 'Name updated' }));
              setDialog(null);
            })
            .catch(fail)
        }
      />
      <RoleDialog
        member={dialog?.kind === 'role' ? dialog.member : null}
        busy={updating}
        onClose={() => setDialog(null)}
        onSave={(newRole) =>
          dialog?.kind === 'role' &&
          updateMember({ groupId, memberId: dialog.member.id, role: newRole })
            .unwrap()
            .then(() => {
              dispatch(showToast({ message: 'Role updated' }));
              setDialog(null);
            })
            .catch(fail)
        }
      />
      <ConfirmDialog
        open={dialog?.kind === 'transfer'}
        title="Transfer ownership?"
        description={dialog?.kind === 'transfer' && `${dialog.member.displayName} will become the owner of this group. You will become an admin.`}
        confirmLabel="Make owner"
        busy={updating}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          dialog?.kind === 'transfer' &&
          updateMember({ groupId, memberId: dialog.member.id, role: 'OWNER' })
            .unwrap()
            .then(() => {
              dispatch(showToast({ message: 'Ownership transferred' }));
              setDialog(null);
            })
            .catch(fail)
        }
      />
      <ConfirmDialog
        open={dialog?.kind === 'remove'}
        title="Remove member?"
        description={
          dialog?.kind === 'remove' &&
          `${dialog.member.displayName} will lose access to the group. Their past expenses stay in the history. Members can only be removed once they are settled up.`
        }
        confirmLabel="Remove"
        destructive
        busy={removing}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          dialog?.kind === 'remove' &&
          remove({ groupId, memberId: dialog.member.id })
            .unwrap()
            .then(() => {
              dispatch(showToast({ message: `${dialog.member.displayName} was removed` }));
              setDialog(null);
            })
            .catch(fail)
        }
      />
      <ConfirmDialog
        open={dialog?.kind === 'leave'}
        title="Leave this group?"
        description="You will lose access to this group. You can only leave once you are settled up. Owners must transfer ownership first if others have joined."
        confirmLabel="Leave group"
        destructive
        busy={leaving}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          leave(groupId)
            .unwrap()
            .then(() => {
              dispatch(showToast({ message: 'You left the group' }));
              navigate('/groups', { replace: true });
            })
            .catch((e) => {
              setDialog(null);
              fail(e);
            })
        }
      />
      <Dialog open={dialog?.kind === 'link'} onClose={() => setDialog(null)} maxWidth="sm" fullWidth aria-labelledby="link-title">
        <DialogTitle id="link-title">Share the invitation link</DialogTitle>
        <DialogContent>
          {dialog?.kind === 'link' && (
            <Stack spacing={2}>
              <Alert severity="info">
                ShareSpace does not send emails in this version. Send this link to {dialog.email} yourself. It only works for that email address, can be used once
                and expires in 7 days. For security it is shown only now.
              </Alert>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 2.5 }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1, overflowWrap: 'anywhere' }}>
                  {dialog.url}
                </Typography>
                <CopyButton text={dialog.url} />
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={() => setDialog(null)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </PageTransition>
  );
}

function AddPersonDialog({ open, groupId, onClose, onInviteLink }: { open: boolean; groupId: string; onClose: () => void; onInviteLink: (url: string, email: string) => void }) {
  const dispatch = useAppDispatch();
  const [add, { isLoading }] = useAddMemberMutation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const emailInvalid = email.trim() !== '' && !EMAIL.test(email.trim());
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="add-person-title" TransitionProps={{ onExited: () => { setName(''); setEmail(''); setError(null); } }}>
      <DialogTitle id="add-person-title">Add a person</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus slotProps={{ htmlInput: { maxLength: 60 } }} />
          <TextField label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={emailInvalid} helperText={emailInvalid ? 'Enter a valid email' : 'Adding an email creates an invitation link'} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={isLoading || !name.trim() || emailInvalid}
          onClick={async () => {
            setError(null);
            try {
              const res = await add({ groupId, displayName: name.trim(), email: email.trim() || undefined }).unwrap();
              dispatch(showToast({ message: `${res.member.displayName} added` }));
              if (res.inviteUrl) onInviteLink(res.inviteUrl, email.trim());
              else onClose();
            } catch (e) {
              setError(toApiError(e).message);
            }
          }}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function InviteDialog({
  open,
  groupId,
  member,
  placeholders,
  isOwner,
  onClose,
  onCreated,
}: {
  open: boolean;
  groupId: string;
  member?: Member;
  placeholders: Member[];
  isOwner: boolean;
  onClose: () => void;
  onCreated: (url: string, email: string) => void;
}) {
  const [invite, { isLoading }] = useCreateInvitationMutation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER' | 'VIEWER'>('MEMBER');
  const [memberId, setMemberId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const valid = EMAIL.test(email.trim());
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="invite-title"
      TransitionProps={{
        onEnter: () => {
          setEmail(member?.email ?? '');
          setMemberId(member?.id ?? '');
          setRole('MEMBER');
          setError(null);
        },
      }}
    >
      <DialogTitle id="invite-title">{member ? `Invite ${member.displayName}` : 'Invite someone'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} helperText={role === 'VIEWER' ? 'Viewers can see everything but cannot change records' : role === 'ADMIN' ? 'Admins can manage members and settings' : 'Members can add and edit records'}>
            {isOwner && <MenuItem value="ADMIN">Admin</MenuItem>}
            <MenuItem value="MEMBER">Member</MenuItem>
            <MenuItem value="VIEWER">Viewer</MenuItem>
          </TextField>
          {!member && placeholders.length > 0 && (
            <TextField select label="Joins as (optional)" value={memberId} onChange={(e) => setMemberId(e.target.value)} helperText="Link to an existing person so their expense history becomes theirs">
              <MenuItem value="">A new member</MenuItem>
              {placeholders.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.displayName}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={isLoading || !valid}
          onClick={async () => {
            setError(null);
            try {
              const res = await invite({ groupId, email: email.trim(), role, memberId: memberId || null }).unwrap();
              onCreated(res.inviteUrl, email.trim());
            } catch (e) {
              setError(toApiError(e).message);
            }
          }}
        >
          Create invitation
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RenameDialog({ member, busy, onClose, onSave }: { member: Member | null; busy: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Dialog open={!!member} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="rename-title" TransitionProps={{ onEnter: () => setName(member?.displayName ?? '') }}>
      <DialogTitle id="rename-title">Rename</DialogTitle>
      <DialogContent>
        <TextField label="Display name in this group" value={name} onChange={(e) => setName(e.target.value)} autoFocus sx={{ mt: 1 }} slotProps={{ htmlInput: { maxLength: 60 } }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" disabled={busy || !name.trim()} onClick={() => onSave(name.trim())}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RoleDialog({ member, busy, onClose, onSave }: { member: Member | null; busy: boolean; onClose: () => void; onSave: (role: Role) => void }) {
  const [role, setRole] = useState<Role>('MEMBER');
  return (
    <Dialog open={!!member} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="role-title" TransitionProps={{ onEnter: () => setRole(member?.role ?? 'MEMBER') }}>
      <DialogTitle id="role-title">Change role for {member?.displayName}</DialogTitle>
      <DialogContent>
        <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} sx={{ mt: 1 }}>
          <MenuItem value="ADMIN">Admin — manages members and settings</MenuItem>
          <MenuItem value="MEMBER">Member — adds and edits records</MenuItem>
          <MenuItem value="VIEWER">Viewer — read only</MenuItem>
        </TextField>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" disabled={busy || role === member?.role} onClick={() => onSave(role)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}


