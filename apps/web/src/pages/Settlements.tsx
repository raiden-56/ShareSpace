import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { ArrowRight, HandCoins, Scale } from 'lucide-react';
import { useSettlementsOverviewQuery } from '../api/api';
import { PageHeader, PageTransition, SectionCard } from '../components/common/Layout';
import { BalanceLabel } from '../components/common/Money';
import { SettlementListSkeleton } from '../components/common/Skeletons';
import { EmptyState, ErrorState } from '../components/common/States';
import { SettlementHistory, SuggestionRow } from '../components/settlements/SettlementParts';
import { SimplifyModeLabel } from '../components/groups/SimplifyDebts';

export default function Settlements() {
  const { data, error, isLoading, refetch } = useSettlementsOverviewQuery();
  const name = useMemo(() => {
    const map = new Map((data?.members ?? []).map((m) => [m.id, m.isYou ? 'You' : m.displayName]));
    return (id: string) => map.get(id) ?? 'Former member';
  }, [data]);
  const groupName = useMemo(() => {
    const map = new Map((data?.groups ?? []).map((g) => [g.groupId, g.groupName]));
    return (id: string) => map.get(id) ?? '';
  }, [data]);

  const withBalance = (data?.groups ?? []).filter((g) => g.suggestions.length > 0);
  const roleOf = new Map((data?.groups ?? []).map((g) => [g.groupId, g.role]));

  return (
    <PageTransition>
      <PageHeader title="Settlements" subtitle="Who should pay whom, and every repayment recorded across your groups." />
      {error ? (
        <ErrorState error={error} onRetry={refetch} title="Could not load settlements" />
      ) : isLoading || !data ? (
        <SettlementListSkeleton rows={4} />
      ) : data.groups.length === 0 ? (
        <Card>
          <EmptyState icon={<HandCoins size={24} />} title="No settlements yet" description="Join or create a group and record expenses. Suggested repayments will appear here." />
        </Card>
      ) : (
        <Stack spacing={2.5}>
          {withBalance.length === 0 ? (
            <Card>
              <EmptyState icon={<Scale size={24} />} title="Everyone is settled up" description="There are no outstanding balances in any of your groups." />
            </Card>
          ) : (
            withBalance.map((g) => {
              const mine = g.suggestions.filter((t) => t.fromMemberId === g.myMemberId || t.toMemberId === g.myMemberId);
              const others = g.suggestions.filter((t) => !mine.includes(t));
              const canRecord = g.role !== 'VIEWER';
              return (
                <Card key={g.groupId} sx={{ overflow: 'hidden' }}>
                  <Box sx={{ height: 4, bgcolor: g.accent }} aria-hidden />
                  <Stack spacing={2} sx={{ p: 2.5 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ sm: 'center' }}>
                      <Box>
                        <Typography variant="h3" component="h2">
                          {g.groupName}
                        </Typography>
                        <SimplifyModeLabel simplified={g.simplifyDebts} variant="caption" />
                        <Button component={RouterLink} to={`/groups/${g.groupId}/balances`} size="small" endIcon={<ArrowRight size={14} />} sx={{ px: 0, minHeight: 28 }}>
                          Balances and history
                        </Button>
                      </Box>
                      <BalanceLabel netMinor={g.myNetMinor} currency={g.currency} />
                    </Stack>
                    {mine.length > 0 && (
                      <Stack spacing={1}>
                        <Typography variant="overline" component="h3">
                          Involving you
                        </Typography>
                        {mine.map((t) => (
                          <SuggestionRow key={`${t.fromMemberId}-${t.toMemberId}`} transfer={t} groupId={g.groupId} currency={g.currency} name={name} myMemberId={g.myMemberId} canRecord={canRecord} />
                        ))}
                      </Stack>
                    )}
                    {others.length > 0 && (
                      <Stack spacing={1}>
                        <Typography variant="overline" component="h3">
                          Between others
                        </Typography>
                        {others.map((t) => (
                          <SuggestionRow key={`${t.fromMemberId}-${t.toMemberId}`} transfer={t} groupId={g.groupId} currency={g.currency} name={name} myMemberId={g.myMemberId} canRecord={canRecord} />
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Card>
              );
            })
          )}

          <SectionCard title="Recent repayments" subtitle="Across all your groups">
            {data.history.length === 0 ? (
              <EmptyState compact icon={<HandCoins size={22} />} title="No repayments recorded yet" />
            ) : (
              <SettlementHistory settlements={data.history} name={name} groupNameOf={groupName} canReverse={(s) => roleOf.get(s.groupId) !== 'VIEWER' && roleOf.has(s.groupId)} />
            )}
          </SectionCard>
        </Stack>
      )}
    </PageTransition>
  );
}
