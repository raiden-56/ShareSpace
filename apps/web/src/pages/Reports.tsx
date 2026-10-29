import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Link,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ChartColumn, Download, Info } from 'lucide-react';
import { endOfYear, format, startOfMonth, startOfYear } from 'date-fns';
import { computeBudgetStatus, SETTLEMENT_METHOD_LABELS } from '@sharespace/core';
import { useGroupsQuery, useReportsQuery, useSettlementsOverviewQuery } from '../api/api';
import { useFormat } from '../hooks/useAuth';
import { addDaysLocal, todayLocal } from '../lib/format';
import { downloadFile } from '../lib/download';
import { useAppDispatch } from '../store';
import { showToast } from '../store/ui';
import { PageHeader, PageTransition, SectionCard, StatTile } from '../components/common/Layout';
import { EmptyState, ErrorState } from '../components/common/States';
import { DashboardSummarySkeleton, ReportChartSkeleton } from '../components/common/Skeletons';
import { BudgetMeter } from '../components/common/Indicators';
import { Money } from '../components/common/Money';
import { GRANULARITY_LABEL, PaidVsShareChart, RankedBarChart, SpendingOverTimeChart, CategoryBreakdownChart } from '../components/charts';

type Preset = '30d' | '90d' | 'month' | 'year' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

function presetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const today = todayLocal();
  switch (preset) {
    case '30d':
      return { from: addDaysLocal(-29), to: today };
    case '90d':
      return { from: addDaysLocal(-89), to: today };
    case 'month':
      return { from: format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: today };
    case 'year':
      return { from: format(startOfYear(new Date()), 'yyyy-MM-dd'), to: format(endOfYear(new Date()), 'yyyy-MM-dd') };
  }
}

function ScrollTable({ caption, headers, numeric = [], children }: { caption: string; headers: string[]; numeric?: number[]; children: React.ReactNode }) {
  return (
    <TableContainer sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2.5 }}>
      <Table size="small">
        <caption className="visually-hidden">{caption}</caption>
        <TableHead>
          <TableRow>
            {headers.map((h, i) => (
              <TableCell key={h} align={numeric.includes(i) ? 'right' : 'left'} sx={{ whiteSpace: 'nowrap' }}>
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>{children}</TableBody>
      </Table>
    </TableContainer>
  );
}

export default function Reports() {
  const fmt = useFormat();
  const dispatch = useAppDispatch();
  const [preset, setPreset] = useState<Preset>('90d');
  const [custom, setCustom] = useState(() => presetRange('30d'));
  const [groupId, setGroupId] = useState('');
  const [currency, setCurrency] = useState('');
  const [exporting, setExporting] = useState(false);

  const range = preset === 'custom' ? custom : presetRange(preset);
  const rangeInvalid = !range.from || !range.to || range.from > range.to;

  const { data: active } = useGroupsQuery();
  const { data: archived } = useGroupsQuery({ archived: true });
  const groupOptions = useMemo(
    () => [...(active?.groups ?? []), ...(archived?.groups ?? []).map((g) => ({ ...g, name: `${g.name} (archived)` }))],
    [active, archived],
  );

  const args = { from: range.from, to: range.to, groupId: groupId || undefined, currency: currency || undefined };
  const { data: report, isLoading, isFetching, error, refetch } = useReportsQuery(args, { skip: rangeInvalid });
  const { data: settlementsData } = useSettlementsOverviewQuery();

  const settlements = useMemo(() => {
    if (!report || !settlementsData) return [];
    const ids = new Set(report.groups.map((g) => g.id));
    return settlementsData.history.filter((s) => ids.has(s.groupId) && s.currency === report.currency && s.date >= report.from && s.date <= report.to);
  }, [report, settlementsData]);
  const settlementName = useMemo(() => new Map((settlementsData?.members ?? []).map((m) => [m.id, m.isYou ? `${m.displayName} (you)` : m.displayName])), [settlementsData]);
  const groupName = useMemo(() => new Map((report?.groups ?? []).map((g) => [g.id, g.name])), [report]);
  const categoryLabel = useMemo(() => new Map((report?.byCategory ?? []).map((c) => [c.key, c.label])), [report]);

  const exportCsv = () => {
    const q = new URLSearchParams({ from: range.from, to: range.to });
    if (groupId) q.set('groupId', groupId);
    if (report?.currency) q.set('currency', report.currency);
    setExporting(true);
    downloadFile(`/api/reports/export.csv?${q.toString()}`, `sharespace-report-${range.from}-to-${range.to}.csv`)
      .then(() => dispatch(showToast({ message: 'Report exported' })))
      .catch((e: Error) => dispatch(showToast({ message: e.message, severity: 'error' })))
      .finally(() => setExporting(false));
  };

  const filters = (
    <Card sx={{ mb: 2.5 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(auto-fit, minmax(170px, 1fr))' }, alignItems: 'start' }}>
          <TextField select label="Date range" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {PRESETS.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
          {preset === 'custom' && (
            <>
              <TextField type="date" label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField
                type="date"
                label="To"
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                error={rangeInvalid}
                helperText={rangeInvalid ? 'End date must be on or after the start date' : undefined}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </>
          )}
          <TextField select label="Group" value={groupId} onChange={(e) => { setGroupId(e.target.value); setCurrency(''); }}>
            <MenuItem value="">All groups</MenuItem>
            {groupOptions.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>
          {report && report.currencies.length > 1 && (
            <TextField select label="Currency" value={report.currency} onChange={(e) => setCurrency(e.target.value)}>
              {report.currencies.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>
      </CardContent>
    </Card>
  );

  const header = (
    <PageHeader
      title="Reports"
      subtitle={report ? `${fmt.date(report.from)} – ${fmt.date(report.to)} · ${report.currency}` : 'Understand where your groups spend.'}
      actions={
        <Button variant="outlined" startIcon={<Download size={18} />} onClick={exportCsv} disabled={!report || exporting || rangeInvalid}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      }
    />
  );

  if (error) {
    return (
      <PageTransition>
        {header}
        {filters}
        <ErrorState error={error} onRetry={refetch} title="Could not build the report" />
      </PageTransition>
    );
  }

  if (rangeInvalid || isLoading || !report) {
    return (
      <PageTransition>
        {header}
        {filters}
        {rangeInvalid ? (
          <Alert severity="warning">Choose a valid date range to see the report.</Alert>
        ) : (
          <Stack spacing={2.5}>
            <DashboardSummarySkeleton />
            <Card>
              <CardContent>
                <ReportChartSkeleton />
              </CardContent>
            </Card>
          </Stack>
        )}
      </PageTransition>
    );
  }

  const cur = report.currency;
  const noGroups = report.groups.length === 0;

  return (
    <PageTransition>
      {header}
      {filters}
      {isFetching && <LinearProgress aria-label="Updating report" sx={{ mb: 2, height: 3 }} />}
      {report.excludedGroups.length > 0 && (
        <Alert severity="info" icon={<Info size={18} />} sx={{ mb: 2.5 }}>
          Groups recorded in other currencies are reported separately. Amounts are never converted or added across currencies.{' '}
          {report.excludedGroups.map((g) => `${g.name} (${g.currency})`).join(', ')} — switch the currency filter to see them.
        </Alert>
      )}

      {noGroups ? (
        <Card>
          <EmptyState icon={<ChartColumn size={26} />} title="No report data yet" description="Create a group and record expenses to see spending reports." action={<Button component={RouterLink} to="/groups" variant="contained">Go to groups</Button>} />
        </Card>
      ) : (
        <>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, mb: 2.5 }}>
            <StatTile label="Total group spending" value={<Money minor={report.totals.spendingMinor} currency={cur} variant="h2" />} hint={`${report.totals.expenseCount} expense${report.totals.expenseCount === 1 ? '' : 's'} in these groups`} />
            <StatTile label="Your share" value={<Money minor={report.totals.myShareMinor} currency={cur} variant="h2" />} hint="What you consumed of those expenses" />
            <StatTile label="You paid" value={<Money minor={report.totals.myPaidMinor} currency={cur} variant="h2" />} hint="Money you put in as a payer" />
            <StatTile label="Repayments recorded" value={<Money minor={report.totals.settlementsMinor} currency={cur} variant="h2" />} hint="Transfers between members, not spending" />
          </Box>

          <Stack spacing={2.5}>
            <SectionCard title="Spending over time" subtitle={`${GRANULARITY_LABEL[report.granularity]} totals`}>
              <SpendingOverTimeChart buckets={report.overTime} currency={cur} granularity={report.granularity} />
            </SectionCard>

            <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: report.groupId ? '1fr' : '1fr 1fr' } }}>
              <SectionCard title="Spending by category">
                <CategoryBreakdownChart rows={report.byCategory.map((c) => ({ key: c.key, label: c.label, amountMinor: c.amountMinor }))} currency={cur} />
              </SectionCard>
              {!report.groupId && (
                <SectionCard title="Spending by group">
                  <RankedBarChart rows={report.byGroup.map((g) => ({ key: g.groupId, label: g.name, amountMinor: g.amountMinor }))} currency={cur} dimension="Group" />
                </SectionCard>
              )}
            </Box>

            <SectionCard title="By person" subtitle="What each person paid compared with their share of expenses">
              <PaidVsShareChart rows={report.byMember.map((m) => ({ key: m.key, name: m.isYou ? `${m.name} (you)` : m.name, paidMinor: m.paidMinor, shareMinor: m.shareMinor }))} currency={cur} />
            </SectionCard>

            <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
              <SectionCard title="Plan spending" subtitle="Recorded expenses linked to plans, against their estimates">
                {report.byPlan.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No expenses linked to plans in this period.
                  </Typography>
                ) : (
                  <ScrollTable caption="Plan spending against estimates" headers={['Plan', 'Estimated', 'Actual', 'Status']} numeric={[1, 2]}>
                    {report.byPlan.map((p) => {
                      const diff = p.estimatedMinor !== null ? p.actualMinor - p.estimatedMinor : null;
                      return (
                        <TableRow key={p.planId}>
                          <TableCell>
                            <Link component={RouterLink} to={`/groups/${p.groupId}/plans/${p.planId}`}>
                              {p.title}
                            </Link>
                          </TableCell>
                          <TableCell align="right" className="tabular">
                            {p.estimatedMinor !== null ? fmt.money(p.estimatedMinor, cur) : '—'}
                          </TableCell>
                          <TableCell align="right" className="tabular">
                            {fmt.money(p.actualMinor, cur)}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap', color: diff !== null && diff > 0 ? 'error.main' : 'text.secondary' }}>
                            {diff === null ? 'No estimate' : diff > 0 ? `Over by ${fmt.money(diff, cur)}` : diff < 0 ? `Under by ${fmt.money(-diff, cur)}` : 'On estimate'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </ScrollTable>
                )}
              </SectionCard>
              <SectionCard title="Budget vs actual" subtitle="Each group's whole budget period, regardless of the date filter">
                {report.budgetVsActual.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    None of these groups has a budget.
                  </Typography>
                ) : (
                  <Stack spacing={2.25}>
                    {report.budgetVsActual.map((b) => {
                      const status = computeBudgetStatus(b.budgetMinor, b.spentMinor, 80);
                      return (
                        <Box key={b.groupId}>
                          <Link component={RouterLink} to={`/groups/${b.groupId}/budget`} variant="subtitle1" underline="hover" sx={{ color: 'text.primary', display: 'inline-block', mb: 0.5 }}>
                            {b.groupName}
                          </Link>
                          <BudgetMeter spentMinor={status.spentMinor} totalMinor={status.budgetMinor} usedBps={status.usedBps} state={status.state} currency={cur} />
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </SectionCard>
            </Box>

            <SectionCard title="Expense history" subtitle={report.expensesTruncated ? 'Showing the 100 most recent expenses. Export CSV for the complete aggregated report, or use a group export for every expense.' : undefined}>
              {report.expenses.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No expenses in this period.
                </Typography>
              ) : (
                <ScrollTable caption="Expenses in this period" headers={['Date', 'Expense', 'Group', 'Category', 'Amount']} numeric={[4]}>
                  {report.expenses.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmt.date(e.date)}</TableCell>
                      <TableCell sx={{ minWidth: 160 }}>
                        <Link component={RouterLink} to={`/groups/${e.groupId}/expenses/${e.id}`}>
                          {e.title}
                        </Link>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{groupName.get(e.groupId) ?? ''}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{categoryLabel.get(e.category) ?? e.category}</TableCell>
                      <TableCell align="right" className="tabular" sx={{ whiteSpace: 'nowrap' }}>
                        {fmt.money(e.amountMinor, e.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </ScrollTable>
              )}
            </SectionCard>

            <SectionCard title="Settlement history" subtitle="Repayments recorded between members in this period">
              {settlements.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No repayments recorded in this period.
                </Typography>
              ) : (
                <ScrollTable caption="Repayments in this period" headers={['Date', 'From', 'To', 'Group', 'Method', 'Status', 'Amount']} numeric={[6]}>
                  {settlements.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmt.date(s.date)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{settlementName.get(s.fromMemberId) ?? 'Former member'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{settlementName.get(s.toMemberId) ?? 'Former member'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{groupName.get(s.groupId) ?? ''}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{SETTLEMENT_METHOD_LABELS[s.method]}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{s.status === 'REVERSED' ? 'Reversed' : 'Recorded'}</TableCell>
                      <TableCell align="right" className="tabular" sx={{ whiteSpace: 'nowrap', textDecoration: s.status === 'REVERSED' ? 'line-through' : 'none' }}>
                        {fmt.money(s.amountMinor, s.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </ScrollTable>
              )}
            </SectionCard>
          </Stack>
        </>
      )}
    </PageTransition>
  );
}
