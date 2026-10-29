import { useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, LinearProgress, Link, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Download, FileText, History, MessageSquare, Paperclip, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api, toApiError, useAddCommentMutation, useDeleteAttachmentMutation, useDeleteCommentMutation } from '../../api/api';
import type { ExpenseDetail } from '../../api/types';
import { useAuth, useFormat } from '../../hooks/useAuth';
import type { GroupHelpers } from '../../hooks/useGroupContext';
import { formatBytes, uploadReceipt, validateUpload, ACCEPTED_UPLOAD_TYPES } from '../../lib/upload';
import { timeAgo } from '../../lib/format';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { MemberAvatar } from '../common/MemberAvatar';
import { SectionCard } from '../common/Layout';

export function ReceiptsSection({ expense, canEdit }: { expense: ExpenseDetail; canEdit: boolean }) {
  const dispatch = useAppDispatch();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [deleteAttachment, { isLoading: removing }] = useDeleteAttachmentMutation();
  const abortRef = useRef<(() => void) | null>(null);

  const upload = async (file: File) => {
    const invalid = validateUpload(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setProgress(0);
    const task = uploadReceipt(expense.groupId, expense.id, file, setProgress);
    abortRef.current = task.abort;
    try {
      await task.promise;
      dispatch(api.util.invalidateTags([{ type: 'Expense', id: expense.id }, 'Expenses', 'Activity']));
      dispatch(showToast({ message: 'Receipt uploaded' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  return (
    <SectionCard
      title="Receipts"
      action={
        canEdit &&
        !expense.deletedAt && (
          <Button component="label" size="small" startIcon={<Upload size={16} />} disabled={progress !== null}>
            Upload
            <input
              type="file"
              hidden
              accept={ACCEPTED_UPLOAD_TYPES.join(',')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void upload(file);
              }}
            />
          </Button>
        )
      }
    >
      {progress !== null && (
        <Box sx={{ mb: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption">Uploading… {Math.round(progress * 100)}%</Typography>
            <Button size="small" color="inherit" onClick={() => abortRef.current?.()}>
              Cancel
            </Button>
          </Stack>
          <LinearProgress variant="determinate" value={progress * 100} aria-label="Upload progress" />
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {expense.attachments.length === 0 ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
          <Paperclip size={16} />
          <Typography variant="body2" color="text.secondary">
            No receipts attached.
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={1.5}>
          {expense.attachments.map((a) => {
            const url = `/api/attachments/${a.id}`;
            const isImage = a.mimeType.startsWith('image/');
            return (
              <Box key={a.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2.5, overflow: 'hidden' }}>
                {isImage && (
                  <Link href={url} target="_blank" rel="noopener" sx={{ display: 'block', bgcolor: 'surface.subtle' }}>
                    <Box component="img" src={url} alt={`Receipt: ${a.fileName}`} loading="lazy" sx={{ display: 'block', width: '100%', maxHeight: 220, objectFit: 'contain' }} />
                  </Link>
                )}
                <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, pl: 1.5 }}>
                  {!isImage && <FileText size={18} aria-hidden />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Link href={url} target="_blank" rel="noopener" variant="body2" noWrap sx={{ display: 'block', fontWeight: 600 }}>
                      {a.fileName}
                    </Link>
                    <Typography variant="caption">{formatBytes(a.sizeBytes)}</Typography>
                  </Box>
                  <Tooltip title="Download">
                    <IconButton component="a" href={`${url}?download=true`} aria-label={`Download ${a.fileName}`}>
                      <Download size={18} />
                    </IconButton>
                  </Tooltip>
                  {canEdit && (
                    <Tooltip title="Remove">
                      <IconButton aria-label={`Remove ${a.fileName}`} onClick={() => setRemoveId(a.id)}>
                        <Trash2 size={18} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
      <ConfirmDialog
        open={!!removeId}
        title="Remove receipt?"
        description="The file will be permanently deleted from ShareSpace. The expense itself is not affected."
        confirmLabel="Remove"
        destructive
        busy={removing}
        onClose={() => setRemoveId(null)}
        onConfirm={async () => {
          if (!removeId) return;
          try {
            await deleteAttachment({ attachmentId: removeId, expenseId: expense.id }).unwrap();
            dispatch(showToast({ message: 'Receipt removed' }));
          } catch (e) {
            dispatch(showToast({ message: toApiError(e).message, severity: 'error' }));
          }
          setRemoveId(null);
        }}
      />
    </SectionCard>
  );
}

export function CommentsSection({ expense, helpers }: { expense: ExpenseDetail; helpers: GroupHelpers }) {
  const { user } = useAuth();
  const dispatch = useAppDispatch();
  const [body, setBody] = useState('');
  const [addComment, { isLoading: posting }] = useAddCommentMutation();
  const [deleteComment] = useDeleteCommentMutation();
  const canComment = helpers.can('editRecords');
  const isAdmin = helpers.data.role === 'OWNER' || helpers.data.role === 'ADMIN';

  const post = async () => {
    const text = body.trim();
    if (!text) return;
    try {
      await addComment({ groupId: expense.groupId, expenseId: expense.id, body: text }).unwrap();
      setBody('');
    } catch (e) {
      dispatch(showToast({ message: toApiError(e).message, severity: 'error' }));
    }
  };

  return (
    <SectionCard title={`Comments${expense.comments.length ? ` (${expense.comments.length})` : ''}`}>
      {expense.comments.length === 0 ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', mb: canComment ? 1.5 : 0 }}>
          <MessageSquare size={16} />
          <Typography variant="body2" color="text.secondary">
            No comments yet.
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={1.75} sx={{ mb: 2 }}>
          {expense.comments.map((c) => {
            const author = helpers.userName(c.authorId);
            const mine = c.authorId === user?.id;
            return (
              <Stack key={c.id} direction="row" spacing={1.25} alignItems="flex-start">
                <MemberAvatar name={author} size={28} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="baseline">
                    <Typography variant="subtitle2" sx={{ color: 'text.primary' }}>
                      {mine ? 'You' : author}
                    </Typography>
                    <Typography variant="caption">{timeAgo(c.createdAt)}</Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {c.body}
                  </Typography>
                </Box>
                {(mine || isAdmin) && canComment && (
                  <Tooltip title="Delete comment">
                    <IconButton
                      aria-label="Delete comment"
                      size="small"
                      sx={{ width: 40, height: 40 }}
                      onClick={() =>
                        deleteComment({ groupId: expense.groupId, expenseId: expense.id, commentId: c.id })
                          .unwrap()
                          .catch((e) => dispatch(showToast({ message: toApiError(e).message, severity: 'error' })))
                      }
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            );
          })}
        </Stack>
      )}
      {canComment && (
        <Stack direction="row" spacing={1} alignItems="flex-end">
          <TextField
            label="Add a comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            multiline
            maxRows={4}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void post();
              }
            }}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />
          <Button variant="contained" onClick={() => void post()} disabled={posting || !body.trim()} sx={{ flexShrink: 0 }}>
            Post
          </Button>
        </Stack>
      )}
    </SectionCard>
  );
}

const ACTION_META = {
  CREATED: { label: 'Created', Icon: Plus },
  UPDATED: { label: 'Edited', Icon: Pencil },
  DELETED: { label: 'Deleted', Icon: Trash2 },
  RESTORED: { label: 'Restored', Icon: RotateCcw },
} as const;

export function HistorySection({ expense, helpers }: { expense: ExpenseDetail; helpers: GroupHelpers }) {
  const fmt = useFormat();
  return (
    <SectionCard title="Edit history">
      {expense.revisions.length === 0 ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
          <History size={16} />
          <Typography variant="body2" color="text.secondary">
            No history recorded.
          </Typography>
        </Stack>
      ) : (
        <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {expense.revisions.map((r) => {
            const meta = ACTION_META[r.action] ?? ACTION_META.UPDATED;
            return (
              <Stack component="li" key={r.id} direction="row" spacing={1.25} alignItems="flex-start">
                <Box aria-hidden sx={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'surface.sage', color: 'primary.main', flexShrink: 0 }}>
                  <meta.Icon size={14} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {meta.label} by {helpers.userName(r.changedById)}
                  </Typography>
                  {r.action === 'UPDATED' && (
                    <Typography variant="body2" color="text.secondary">
                      {r.summary}
                    </Typography>
                  )}
                  <Typography variant="caption">
                    {fmt.dateTime(r.createdAt)} · version {r.version}
                  </Typography>
                </Box>
              </Stack>
            );
          })}
        </Stack>
      )}
    </SectionCard>
  );
}
