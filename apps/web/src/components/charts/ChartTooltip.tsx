import { Box, Paper, Stack, Typography } from '@mui/material';
import { formatMoney } from '@sharespace/core';

interface TooltipEntry {
  name?: unknown;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: unknown;
}

/**
 * Hover tooltip shared by every chart. Values are minor units formatted as money; series identity
 * comes from the swatch, text stays in text colours.
 */
export function ChartTooltip({ active, payload, label, currency, labelFormatter }: ChartTooltipProps & { currency: string; labelFormatter?: (label: string) => string }) {
  if (!active || !payload || payload.length === 0) return null;
  const title = labelFormatter ? labelFormatter(String(label ?? '')) : String(label ?? '');
  return (
    <Paper variant="outlined" sx={{ px: 1.5, py: 1, borderRadius: 2.5, boxShadow: '0 6px 20px rgba(41,45,41,0.12)', minWidth: 150 }}>
      {title && (
        <Typography variant="caption" component="p" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          {title}
        </Typography>
      )}
      <Stack spacing={0.4}>
        {payload.map((p, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={0.75} alignItems="center">
              {p.color && <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: p.color }} />}
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {String(p.name ?? '')}
              </Typography>
            </Stack>
            <Typography variant="caption" className="tabular" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {typeof p.value === 'number' ? formatMoney(p.value, currency) : String(p.value ?? '')}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
