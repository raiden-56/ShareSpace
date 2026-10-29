import { useState } from 'react';
import { Alert, Box, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { GitMerge, Users } from 'lucide-react';
import { api, toApiError, useUpdateGroupMutation } from '../../api/api';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';

export const SIMPLIFY_LABEL = { on: 'Simplified: fewest repayments', off: 'Who owes whom' } as const;

export const SIMPLIFY_EXPLANATION = {
  on: 'ShareSpace combines debts so the group needs the fewest repayments (e.g. if Asha owes Ben and Ben owes Chen, Asha pays Chen directly).',
  off: 'Each person repays the people they actually owe.',
} as const;

/** Icon + words for the active mode, so it never relies on colour alone. */
export function SimplifyModeLabel({ simplified, variant = 'body2' }: { simplified: boolean; variant?: 'body2' | 'caption' }) {
  const Icon = simplified ? GitMerge : Users;
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary', minWidth: 0 }}>
      <Icon size={variant === 'caption' ? 14 : 16} aria-hidden style={{ flexShrink: 0 }} />
      <Typography variant={variant} color="text.secondary" component="span">
        {simplified ? SIMPLIFY_LABEL.on : SIMPLIFY_LABEL.off}
      </Typography>
    </Stack>
  );
}

/**
 * The "Simplify debts" setting. Managers get a switch that saves immediately; the toggle only
 * moves and the success message only shows after the server confirms. Others see the state as text.
 */
export function SimplifyDebtsControl({ groupId, value, editable }: { groupId: string; value: boolean; editable: boolean }) {
  const dispatch = useAppDispatch();
  const [update, { isLoading }] = useUpdateGroupMutation();
  const [error, setError] = useState<string | null>(null);

  const change = async (next: boolean) => {
    setError(null);
    try {
      await update({ groupId, simplifyDebts: next }).unwrap();
      // Suggested repayments and friend balances follow this setting, so refresh them too.
      dispatch(api.util.invalidateTags(['Balances', 'Settlements', 'Friends']));
      dispatch(showToast({ message: next ? 'Debts are now simplified' : 'Debts now stay between the people who owe them' }));
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  const description = (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Simplify debts
      </Typography>
      <Typography variant="caption" component="p" id={`simplify-help-${groupId}`}>
        {value ? SIMPLIFY_EXPLANATION.on : SIMPLIFY_EXPLANATION.off}
      </Typography>
    </Box>
  );

  return (
    <Stack spacing={1}>
      {error && <Alert severity="error">{error}</Alert>}
      {editable ? (
        <FormControlLabel
          control={
            <Switch
              checked={value}
              disabled={isLoading}
              onChange={(e) => void change(e.target.checked)}
              slotProps={{ input: { 'aria-describedby': `simplify-help-${groupId}` } }}
            />
          }
          label={description}
          sx={{ alignItems: 'flex-start', mr: 0, '& .MuiSwitch-root': { mt: -0.5 } }}
        />
      ) : (
        <Stack spacing={0.5}>
          {description}
          <Typography variant="caption" component="p">
            Currently {value ? 'on' : 'off'}. Only the owner and admins can change this.
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}
