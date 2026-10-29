import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { MessageSquare, Paperclip, Repeat } from 'lucide-react';
import type { ExpenseSummary } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { CategoryIcon } from '../common/Indicators';
import { Money } from '../common/Money';
import { repeatBadge, viewerPosition, viewerPositionColor, viewerPositionText } from './repeat';

interface ExpenseRowProps {
  expense: ExpenseSummary;
  /** Member id of the signed-in user in this expense's group (for "you lent / you borrowed"). */
  myMemberId?: string | null;
  memberName: (id: string) => string;
  categoryName: (id: string) => string;
  /** Shown under the title, e.g. the group name on cross-group lists. */
  context?: string;
}

/** One expense in a list: title, payer, date, category, amount and what the viewer lent or borrowed. Links to details. */
export function ExpenseRow({ expense, myMemberId, memberName, categoryName, context }: ExpenseRowProps) {
  const fmt = useFormat();
  const payers = expense.payers.map((p) => memberName(p.memberId));
  const payerText = payers.length > 1 ? `${payers[0]} +${payers.length - 1}` : (payers[0] ?? '');
  // Payer and share amounts are always in the group currency, so this is correct for foreign expenses too.
  const position = myMemberId ? viewerPosition(expense, myMemberId) : null;
  const positionText = position ? viewerPositionText(position, (m) => fmt.money(m, expense.currency)) : null;
  const repeat = repeatBadge(expense);
  const foreign = expense.originalCurrency !== expense.currency;

  return (
    <ButtonBase
      component={RouterLink}
      to={`/groups/${expense.groupId}/expenses/${expense.id}`}
      sx={{ display: 'flex', width: '100%', textAlign: 'left', py: 1.5, px: 1, mx: -1, borderRadius: 2.5, gap: 1.75, alignItems: 'center', '&:hover': { bgcolor: 'action.hover' } }}
      aria-label={[`${expense.title}, ${fmt.money(expense.amountMinor, expense.currency)}, paid by ${payerText}`, positionText, repeat].filter(Boolean).join('. ')}
    >
      <CategoryIcon category={expense.category} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" noWrap sx={{ textDecoration: expense.deletedAt ? 'line-through' : 'none' }}>
          {expense.title}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary', minWidth: 0 }}>
          <Typography variant="caption" noWrap component="span">
            {[context, `${payerText} paid`, fmt.day(expense.date), categoryName(expense.category)].filter(Boolean).join(' · ')}
          </Typography>
          {expense.attachmentCount > 0 && <Paperclip size={12} aria-label="Has receipt" />}
          {expense.commentCount > 0 && <MessageSquare size={12} aria-label={`${expense.commentCount} comments`} />}
        </Stack>
        {repeat && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
            <Repeat size={12} aria-hidden />
            <Typography variant="caption" component="span" noWrap>
              {repeat}
            </Typography>
          </Stack>
        )}
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Money minor={expense.amountMinor} currency={expense.currency} sx={{ display: 'block', fontSize: '0.95rem' }} />
        {foreign && (
          <Typography variant="caption" component="div" className="tabular">
            {fmt.money(expense.originalAmountMinor, expense.originalCurrency)}
          </Typography>
        )}
        {position && (
          <Typography variant="caption" component="div" className="tabular" sx={{ color: viewerPositionColor(position), fontWeight: position.kind === 'lent' || position.kind === 'borrowed' ? 600 : 400 }}>
            {positionText}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}
