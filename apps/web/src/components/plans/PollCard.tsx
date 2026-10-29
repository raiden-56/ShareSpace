import { useEffect, useId, useState } from 'react';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { CircleCheck, Clock, Lock, Trophy } from 'lucide-react';
import { toApiError, useClosePollMutation, useRetractVoteMutation, useVoteMutation } from '../../api/api';
import type { Poll } from '../../api/types';
import { useAuth, useFormat } from '../../hooks/useAuth';
import { pluralize } from '../../lib/format';
import { useAppDispatch } from '../../store';
import { showToast } from '../../store/ui';
import { ConfirmDialog } from '../common/ConfirmDialog';

export function isPollClosed(poll: Pick<Poll, 'closedAt' | 'closesAt'>, now = new Date()): boolean {
  return !!poll.closedAt || (!!poll.closesAt && parseISO(poll.closesAt) <= now);
}

export function pollPercent(votes: number, total: number): number {
  return total > 0 ? Math.round((votes * 100) / total) : 0;
}

/** Outcome sentence for a closed poll. */
export function pollOutcome(poll: Pick<Poll, 'options'>): string {
  const max = Math.max(0, ...poll.options.map((o) => o.votes));
  if (max === 0) return 'Closed with no votes.';
  const winners = poll.options.filter((o) => o.votes === max).map((o) => o.label);
  if (winners.length === 1) return `Decision: ${winners[0]} (${pluralize(max, 'vote')})`;
  return `Tie between ${winners.join(' and ')} (${pluralize(max, 'vote')} each)`;
}

export interface PollCardViewProps {
  poll: Poll;
  canClose: boolean;
  busy?: boolean;
  planTitle?: string | null;
  onVote: (optionId: string) => void;
  onRetract: () => void;
  onClose: () => void;
}

/** Presentational poll: accessible radio voting plus results that show counts and percentages in text. */
export function PollCardView({ poll, canClose, busy, planTitle, onVote, onRetract, onClose }: PollCardViewProps) {
  const id = useId();
  const fmt = useFormat();
  const closed = isPollClosed(poll);
  const [selected, setSelected] = useState<string>(poll.myVote ?? '');
  useEffect(() => setSelected(poll.myVote ?? ''), [poll.myVote]);

  const votingDisabled = closed || !poll.canVote || busy;
  const changed = selected !== '' && selected !== poll.myVote;
  const max = Math.max(0, ...poll.options.map((o) => o.votes));

  const status = closed ? (
    <Chip size="small" icon={<Lock size={13} />} label={poll.closedAt ? `Closed ${fmt.dateTime(poll.closedAt)}` : 'Closed'} variant="outlined" />
  ) : poll.closesAt ? (
    <Chip size="small" icon={<Clock size={13} />} label={`Closes in ${formatDistanceToNowStrict(parseISO(poll.closesAt))}`} variant="outlined" sx={{ color: 'money.attention', borderColor: 'currentColor', '& .MuiChip-icon': { color: 'inherit' } }} />
  ) : (
    <Chip size="small" label="Open" variant="outlined" color="primary" />
  );

  return (
    <Card component="section" aria-labelledby={`${id}-q`} sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        {status}
        <Typography variant="caption" component="span" className="tabular">
          {pluralize(poll.totalVotes, 'vote')}
          {planTitle ? ` · ${planTitle}` : ''}
        </Typography>
      </Stack>
      <FormControl component="fieldset" disabled={votingDisabled} sx={{ width: '100%' }}>
        <FormLabel component="legend" id={`${id}-q`} sx={{ typography: 'h4', color: 'text.primary', mb: 1, '&.Mui-focused, &.Mui-disabled': { color: 'text.primary' } }}>
          {poll.question}
        </FormLabel>
        <RadioGroup name={`poll-${poll.id}`} value={selected} onChange={(e) => setSelected(e.target.value)}>
          <Stack spacing={1.25}>
            {poll.options.map((o) => {
              const pct = pollPercent(o.votes, poll.totalVotes);
              const mine = poll.myVote === o.id;
              const leading = closed && max > 0 && o.votes === max;
              return (
                <Box key={o.id}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                    <FormControlLabel
                      value={o.id}
                      control={<Radio size="small" />}
                      label={o.label}
                      sx={{ flex: 1, minWidth: 0, mr: 0, '& .MuiFormControlLabel-label': { overflowWrap: 'anywhere', fontWeight: mine || leading ? 650 : 500 } }}
                    />
                    {mine && (
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'primary.main', flexShrink: 0 }}>
                        <CircleCheck size={14} aria-hidden />
                        <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 650 }}>
                          Your vote
                        </Typography>
                      </Stack>
                    )}
                    {leading && <Trophy size={14} aria-label="Most votes" />}
                    <Typography variant="caption" className="tabular" sx={{ flexShrink: 0, minWidth: 92, textAlign: 'right' }} data-testid={`poll-result-${o.id}`}>
                      {pluralize(o.votes, 'vote')} · {pct}%
                    </Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={pct} aria-hidden sx={{ height: 6, ml: 4 }} color={leading ? 'primary' : 'inherit'} />
                </Box>
              );
            })}
          </Stack>
        </RadioGroup>
      </FormControl>

      {closed && (
        <Alert severity="info" icon={<Trophy size={18} />} sx={{ mt: 2 }}>
          {pollOutcome(poll)}
        </Alert>
      )}
      {!closed && !poll.isEligible && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          You are not eligible to vote in this poll. You can still follow the results.
        </Typography>
      )}
      {!closed && poll.isEligible && poll.myVote && !poll.allowVoteChange && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Votes are final in this poll.
        </Typography>
      )}

      {(!closed && (poll.canVote || (poll.myVote && poll.allowVoteChange))) || (!closed && canClose) ? (
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1, '& > *': { m: '0 !important' } }}>
          {poll.canVote && (
            <Button variant="contained" disabled={!changed || busy} onClick={() => onVote(selected)}>
              {poll.myVote ? 'Change vote' : 'Vote'}
            </Button>
          )}
          {poll.myVote && poll.allowVoteChange && (
            <Button variant="outlined" color="inherit" disabled={busy} onClick={onRetract}>
              Retract vote
            </Button>
          )}
          {canClose && (
            <Button color="inherit" disabled={busy} onClick={onClose} sx={{ ml: 'auto !important' }}>
              Close poll
            </Button>
          )}
        </Stack>
      ) : null}
    </Card>
  );
}

/** Poll wired to the API. */
export function PollCard({ poll, canManage, planTitle }: { poll: Poll; canManage: boolean; planTitle?: string | null }) {
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const [vote, voteState] = useVoteMutation();
  const [retract, retractState] = useRetractVoteMutation();
  const [closePoll, closeState] = useClosePollMutation();
  const [confirmClose, setConfirmClose] = useState(false);
  const busy = voteState.isLoading || retractState.isLoading || closeState.isLoading;
  const canClose = !isPollClosed(poll) && (canManage || poll.createdById === user?.id);
  const fail = (err: unknown) => dispatch(showToast({ message: toApiError(err).message, severity: 'error' }));

  return (
    <>
      <PollCardView
        poll={poll}
        canClose={canClose}
        busy={busy}
        planTitle={planTitle}
        onVote={(optionId) =>
          vote({ groupId: poll.groupId, pollId: poll.id, optionId })
            .unwrap()
            .then(() => dispatch(showToast({ message: poll.myVote ? 'Vote changed' : 'Vote recorded' })))
            .catch(fail)
        }
        onRetract={() =>
          retract({ groupId: poll.groupId, pollId: poll.id })
            .unwrap()
            .then(() => dispatch(showToast({ message: 'Vote retracted' })))
            .catch(fail)
        }
        onClose={() => setConfirmClose(true)}
      />
      <ConfirmDialog
        open={confirmClose}
        title="Close this poll?"
        description="Voting ends for everyone and the result is recorded in the group's activity."
        confirmLabel="Close poll"
        busy={closeState.isLoading}
        onClose={() => setConfirmClose(false)}
        onConfirm={() =>
          closePoll({ groupId: poll.groupId, pollId: poll.id })
            .unwrap()
            .then(() => {
              setConfirmClose(false);
              dispatch(showToast({ message: 'Poll closed' }));
            })
            .catch((err) => {
              setConfirmClose(false);
              fail(err);
            })
        }
      />
    </>
  );
}
