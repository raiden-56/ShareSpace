import { useState, type ReactNode } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  /** When set, the user must type a reason (e.g. reversing a settlement). */
  reasonLabel?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** Accessible confirmation dialog. MUI restores focus to the trigger when it closes. */
export function ConfirmDialog({ open, title, description, confirmLabel, destructive, busy, reasonLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const disabled = busy || (!!reasonLabel && reason.trim().length === 0);
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="confirm-title"
      TransitionProps={{ onExited: () => setReason('') }}
    >
      <DialogTitle id="confirm-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div" sx={{ color: 'text.secondary' }}>
          {description}
        </DialogContentText>
        {reasonLabel && (
          <TextField
            autoFocus
            label={reasonLabel}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            sx={{ mt: 2 }}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy} color="inherit">
          Cancel
        </Button>
        <Button variant="contained" color={destructive ? 'error' : 'primary'} onClick={() => onConfirm(reason.trim())} disabled={disabled}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
