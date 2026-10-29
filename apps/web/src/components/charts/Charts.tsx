import { useMemo } from 'react';
import { useTheme } from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, type Granularity } from '@sharespace/core';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip } from './ChartTooltip';
import { bucketLabel, foldSeries, GRANULARITY_LABEL, type RankedRow } from './fold';

/** Recessive axis and grid styling shared by every chart. */
function useAxis() {
  const theme = useTheme();
  return useMemo(
    () => ({
      tick: { fill: theme.palette.text.secondary, fontSize: 11.5, fontFamily: theme.typography.fontFamily },
      grid: theme.palette.divider,
      surface: theme.palette.background.paper,
      cursor: theme.palette.action.hover,
      palette: theme.palette.chart,
      other: theme.palette.chartOther,
    }),
    [theme],
  );
}

const compact = (currency: string) => (v: number) => formatMoney(v, currency, { compact: true });
const INITIAL = { width: 600, height: 260 };

// ---------- Spending over time ----------

export interface SpendingOverTimeChartProps {
  buckets: readonly { key: string; amountMinor: number }[];
  currency: string;
  granularity: Granularity;
  height?: number;
  emptyText?: string;
}

/** Single-series bars of spending per period (empty periods included so gaps are visible). */
export function SpendingOverTimeChart({ buckets, currency, granularity, height = 240, emptyText }: SpendingOverTimeChartProps) {
  const axis = useAxis();
  const total = buckets.reduce((a, b) => a + b.amountMinor, 0);
  const peak = buckets.reduce((m, b) => (b.amountMinor > m.amountMinor ? b : m), buckets[0] ?? { key: '', amountMinor: 0 });
  const data = buckets.map((b) => ({ ...b, label: bucketLabel(b.key, granularity) }));
  const summary =
    total === 0
      ? 'No spending in this period.'
      : `${GRANULARITY_LABEL[granularity]} spending across ${buckets.length} periods totalling ${formatMoney(total, currency)}. Highest: ${bucketLabel(peak.key, granularity, true)} at ${formatMoney(peak.amountMinor, currency)}.`;
  return (
    <ChartFrame
      summary={summary}
      height={height}
      empty={total === 0}
      emptyText={emptyText ?? 'No expenses recorded in this period.'}
      table={{
        caption: `${GRANULARITY_LABEL[granularity]} spending`,
        headers: ['Period', 'Spending'],
        rows: buckets.map((b) => [bucketLabel(b.key, granularity, true), formatMoney(b.amountMinor, currency)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={axis.grid} />
          <XAxis dataKey="label" tick={axis.tick} tickLine={false} axisLine={false} minTickGap={16} interval="preserveStartEnd" />
          <YAxis tick={axis.tick} tickLine={false} axisLine={false} width={64} tickFormatter={compact(currency)} />
          <Tooltip
            cursor={{ fill: axis.cursor }}
            content={(p) => (
              <ChartTooltip
                active={p.active}
                label={p.label}
                payload={p.payload}
                currency={currency}
                labelFormatter={(l) => {
                  const row = data.find((d) => d.label === l);
                  return row ? bucketLabel(row.key, granularity, true) : l;
                }}
              />
            )}
          />
          <Bar dataKey="amountMinor" name="Spending" fill={axis.palette[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------- Ranked horizontal bars (categories, groups) ----------

export interface RankedBarChartProps {
  rows: readonly RankedRow[];
  currency: string;
  /** Noun for the table header and summary, e.g. "Category". */
  dimension: string;
  max?: number;
  emptyText?: string;
}

/**
 * Horizontal bars ranked by amount. One series, so one colour; anything past `max` folds into a
 * neutral "Other" bar.
 */
export function RankedBarChart({ rows, currency, dimension, max = 6, emptyText }: RankedBarChartProps) {
  const axis = useAxis();
  const folded = foldSeries(rows, max);
  const total = folded.reduce((a, r) => a + r.amountMinor, 0);
  const height = Math.max(120, folded.length * 38 + 16);
  const top = folded[0];
  const summary = top
    ? `Spending by ${dimension.toLowerCase()}: ${folded.length} ${folded.length === 1 ? 'entry' : 'entries'} totalling ${formatMoney(total, currency)}. Largest: ${top.label} at ${formatMoney(top.amountMinor, currency)}.`
    : 'No spending in this period.';
  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');
  return (
    <ChartFrame
      summary={summary}
      height={height}
      empty={folded.length === 0}
      emptyText={emptyText ?? 'No expenses recorded in this period.'}
      table={{
        caption: `Spending by ${dimension.toLowerCase()}`,
        headers: [dimension, 'Spending', 'Share of total'],
        rows: folded.map((r) => [r.label, formatMoney(r.amountMinor, currency), pct(r.amountMinor)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        <BarChart data={folded} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={axis.grid} />
          <XAxis type="number" tick={axis.tick} tickLine={false} axisLine={false} tickFormatter={compact(currency)} />
          <YAxis type="category" dataKey="label" tick={axis.tick} tickLine={false} axisLine={false} width={112} />
          <Tooltip cursor={{ fill: axis.cursor }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} currency={currency} />} />
          <Bar dataKey="amountMinor" name="Spending" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {folded.map((r) => (
              <Cell key={r.key} fill={r.isOther ? axis.other : axis.palette[0]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface CategoryBreakdownChartProps {
  rows: readonly RankedRow[];
  currency: string;
  emptyText?: string;
}

export function CategoryBreakdownChart({ rows, currency, emptyText }: CategoryBreakdownChartProps) {
  return <RankedBarChart rows={rows} currency={currency} dimension="Category" emptyText={emptyText} />;
}

// ---------- Paid vs share per person (two series, one axis) ----------

export interface PersonRow {
  key: string;
  name: string;
  paidMinor: number;
  shareMinor: number;
}

export function PaidVsShareChart({ rows, currency }: { rows: readonly PersonRow[]; currency: string }) {
  const axis = useAxis();
  const visible = rows.slice(0, 12);
  const paidColor = axis.palette[0]!;
  const shareColor = axis.palette[1]!;
  const height = Math.max(160, visible.length * 52 + 24);
  const summary = visible.length
    ? `Paid versus share for ${visible.length} people. ${visible.map((r) => `${r.name} paid ${formatMoney(r.paidMinor, currency)} with a share of ${formatMoney(r.shareMinor, currency)}`).join('; ')}.`
    : 'No spending in this period.';
  return (
    <ChartFrame
      summary={summary}
      height={height}
      empty={visible.length === 0}
      legend={[
        { label: 'Paid', color: paidColor },
        { label: 'Share', color: shareColor },
      ]}
      table={{
        caption: 'Amount paid and share consumed per person',
        headers: ['Person', 'Paid', 'Share', 'Difference'],
        rows: rows.map((r) => [
          r.name,
          formatMoney(r.paidMinor, currency),
          formatMoney(r.shareMinor, currency),
          r.paidMinor === r.shareMinor ? 'Even' : `${r.paidMinor > r.shareMinor ? 'Paid more by' : 'Paid less by'} ${formatMoney(Math.abs(r.paidMinor - r.shareMinor), currency)}`,
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        <BarChart data={visible} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap={10}>
          <CartesianGrid horizontal={false} stroke={axis.grid} />
          <XAxis type="number" tick={axis.tick} tickLine={false} axisLine={false} tickFormatter={compact(currency)} />
          <YAxis type="category" dataKey="name" tick={axis.tick} tickLine={false} axisLine={false} width={104} />
          <Tooltip cursor={{ fill: axis.cursor }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} currency={currency} />} />
          <Bar dataKey="paidMinor" name="Paid" fill={paidColor} radius={[0, 4, 4, 0]} maxBarSize={16} />
          <Bar dataKey="shareMinor" name="Share" fill={shareColor} radius={[0, 4, 4, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------- Cumulative spending vs budget ----------

export interface BudgetTrendChartProps {
  points: readonly { key: string; amountMinor: number; cumulativeMinor: number }[];
  budgetMinor: number;
  currency: string;
  granularity: Granularity;
}

/** Cumulative recorded spending as a line, with the budget as a reference line on the same axis. */
export function BudgetTrendChart({ points, budgetMinor, currency, granularity }: BudgetTrendChartProps) {
  const axis = useAxis();
  const theme = useTheme();
  const data = points.map((p) => ({ ...p, label: bucketLabel(p.key, granularity) }));
  const last = points[points.length - 1];
  const maxY = Math.max(budgetMinor, last?.cumulativeMinor ?? 0);
  const summary = last
    ? `Cumulative spending reached ${formatMoney(last.cumulativeMinor, currency)} against a budget of ${formatMoney(budgetMinor, currency)}.`
    : 'No spending recorded in the budget period.';
  return (
    <ChartFrame
      summary={summary}
      height={240}
      empty={!last || last.cumulativeMinor === 0}
      emptyText="No spending recorded in the budget period yet."
      legend={[
        { label: 'Cumulative spending', color: axis.palette[0]! },
        { label: 'Budget', color: theme.palette.text.secondary },
      ]}
      table={{
        caption: 'Cumulative spending against the budget',
        headers: ['Period', 'Spent in period', 'Cumulative', 'Budget remaining'],
        rows: points.map((p) => [
          bucketLabel(p.key, granularity, true),
          formatMoney(p.amountMinor, currency),
          formatMoney(p.cumulativeMinor, currency),
          budgetMinor - p.cumulativeMinor >= 0 ? formatMoney(budgetMinor - p.cumulativeMinor, currency) : `Over by ${formatMoney(p.cumulativeMinor - budgetMinor, currency)}`,
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
        <LineChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke={axis.grid} />
          <XAxis dataKey="label" tick={axis.tick} tickLine={false} axisLine={false} minTickGap={16} interval="preserveStartEnd" />
          <YAxis tick={axis.tick} tickLine={false} axisLine={false} width={64} tickFormatter={compact(currency)} domain={[0, Math.ceil(maxY * 1.08)]} />
          <Tooltip
            content={(p) => (
              <ChartTooltip
                active={p.active}
                label={p.label}
                payload={p.payload?.filter((x) => x.dataKey === 'cumulativeMinor')}
                currency={currency}
                labelFormatter={(l) => {
                  const row = data.find((d) => d.label === l);
                  return row ? bucketLabel(row.key, granularity, true) : l;
                }}
              />
            )}
          />
          <ReferenceLine
            y={budgetMinor}
            stroke={theme.palette.text.secondary}
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{ value: `Budget ${formatMoney(budgetMinor, currency, { compact: true })}`, position: 'insideTopRight', fill: theme.palette.text.secondary, fontSize: 11.5 }}
          />
          <Line
            type="monotone"
            dataKey="cumulativeMinor"
            name="Cumulative spending"
            stroke={axis.palette[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: axis.surface }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
