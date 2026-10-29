import { useId, useState, type ReactNode } from 'react';
import { Box, Button, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { ChartColumn, Table2 } from 'lucide-react';

export interface ChartTable {
  caption: string;
  headers: string[];
  /** Columns aligned right (numbers). Defaults to every column except the first. */
  numericColumns?: number[];
  rows: ReactNode[][];
}

export interface LegendItem {
  label: string;
  color: string;
}

interface ChartFrameProps {
  /** One-sentence summary read by screen readers in place of the graphic. */
  summary: string;
  table: ChartTable;
  height?: number;
  empty?: boolean;
  emptyText?: string;
  legend?: LegendItem[];
  children: ReactNode;
  /** Extra controls placed before the table toggle. */
  toolbar?: ReactNode;
}

/**
 * Wraps a chart with: an accessible summary, an HTML legend (text in text colours, swatch carries
 * identity), a "View as table" toggle, and a meaningful empty state. Never renders fake data.
 */
export function ChartFrame({ summary, table, height = 260, empty, emptyText = 'No data for this period yet.', legend, children, toolbar }: ChartFrameProps) {
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();

  if (empty) {
    return (
      <Box sx={{ height: Math.min(height, 180), display: 'grid', placeItems: 'center', textAlign: 'center', px: 2, border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 3 }}>
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      </Box>
    );
  }

  const numeric = new Set(table.numericColumns ?? table.headers.map((_, i) => i).filter((i) => i > 0));

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1, minHeight: 32, flexWrap: 'wrap', rowGap: 1 }}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0.5 }} aria-label="Legend" role="list">
          {legend && legend.length >= 2 &&
            legend.map((l) => (
              <Stack key={l.label} direction="row" spacing={0.75} alignItems="center" role="listitem">
                <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: l.color }} />
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  {l.label}
                </Typography>
              </Stack>
            ))}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          {toolbar}
          <Button
            size="small"
            color="inherit"
            onClick={() => setAsTable((v) => !v)}
            startIcon={asTable ? <ChartColumn size={15} /> : <Table2 size={15} />}
            aria-pressed={asTable}
            aria-controls={tableId}
            sx={{ color: 'text.secondary', minHeight: 32 }}
          >
            {asTable ? 'View as chart' : 'View as table'}
          </Button>
        </Stack>
      </Stack>
      {asTable ? (
        <TableContainer id={tableId} sx={{ maxHeight: Math.max(height, 260), overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2.5 }}>
          <Table size="small" stickyHeader>
            <caption className="visually-hidden">{table.caption}</caption>
            <TableHead>
              <TableRow>
                {table.headers.map((h, i) => (
                  <TableCell key={h} align={numeric.has(i) ? 'right' : 'left'} sx={{ bgcolor: 'background.paper' }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {table.rows.map((row, r) => (
                <TableRow key={r}>
                  {row.map((cell, c) => (
                    <TableCell key={c} align={numeric.has(c) ? 'right' : 'left'} className={numeric.has(c) ? 'tabular' : undefined} sx={{ whiteSpace: 'nowrap' }}>
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Box role="img" aria-label={summary} sx={{ width: '100%', height, minWidth: 0 }}>
          {children}
        </Box>
      )}
    </Box>
  );
}
