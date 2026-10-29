import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { MessageSquare, Paperclip } from 'lucide-react';
import type { ExpenseSummary } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';
import { CategoryIcon } from '../common/Indicators';
import { Money } from '../common/Money';

interface ExpenseRowProps {
  expense: ExpenseSummary;
  /** Member id of the signed-in user in this expense's group (for "your share"). */
  myMemberId?: string | null;
  memberName: (id: string) => string;
  categoryName: (id: string) => string;
  /** Shown under the title, e.g. the group name on cross-group lists. */
  context?: string;
}

/** One expense in a list: title, payer, date, category, amount and the viewer's share. Links to details. */
export function ExpenseRow({ expense, myMemberId, memberName, categoryName, context }: ExpenseRowProps) {
  const fmt = useFormat();
  const payers = expense.payers.map((p) => memberName(p.memberId));
  const payerText = payers.length > 1 ? `${payers[0]} +${payers.length - 1}` : (payers[0] ?? '');
  const myShare = myMemberId ? (expense.shares.find((s) => s.memberId === myMemberId)?.amountMinor ?? 0) : null;
  const myPaid = myMemberId ? (expense.payers.find((p) => p.memberId === myMemberId)?.amountMinor ?? 0) : 0;
  const foreign = expense.originalCurrency !== expense.currency;

  return (
    <ButtonBase
      component={RouterLink}
      to={`/groups/${expense.groupId}/expenses/${expense.id}`}
      sx={{ display: 'flex', width: '100%', textAlign: 'left', py: 1.5, px: 1, mx: -1, borderRadius: 2.5, gap: 1.75, alignItems: 'center', '&:hover': { bgcolor: 'action.hover' } }}
      aria-label={`${expense.title}, ${fmt.money(expense.amountMinor, expense.currency)}, paid by ${payerText}`}
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
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Money minor={expense.amountMinor} currency={expense.currency} sx={{ display: 'block', fontSize: '0.95rem' }} />
        {foreign && (
          <Typography variant="caption" component="div" className="tabular">
            {fmt.money(expense.originalAmountMinor, expense.originalCurrency)}
          </Typography>
        )}
        {myShare !== null && !foreign && (
          <Typography variant="caption" component="div" className="tabular" sx={{ color: myPaid - myShare > 0 ? 'money.positive' : myShare > 0 ? 'money.negative' : 'text.secondary' }}>
            {myShare === 0 && myPaid === 0
              ? 'Not involved'
              : myPaid - myShare > 0
                ? `You lent ${fmt.money(myPaid - myShare, expense.currency)}`
                : `Your share ${fmt.money(myShare, expense.currency)}`}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}
