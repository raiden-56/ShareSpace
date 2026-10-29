import { useEffect, useState, type ReactNode } from 'react';
import {
  Badge,
  Box,
  Button,
  Collapse,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { ArrowDown, ArrowUp, Filter, Search, X } from 'lucide-react';
import type { Member } from '../../api/types';
import { activeFilterCount, amountParamError, SORTS } from './filterParams';

export interface ExpenseFiltersProps {
  params: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
  categories: { id: string; label: string }[];
  members?: Member[];
  plans?: { id: string; title: string }[];
  /** Global page: lets the user scope to one group. */
  groups?: { id: string; name: string }[];
  decimals: number;
  currencySymbol: string;
}

/** Search, filter and sort controls bound to URL search params. Filters live in a bottom sheet on phones. */
export function ExpenseFilters({ params, onChange, categories, members, plans, groups, decimals, currencySymbol }: ExpenseFiltersProps) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(params.get('q') ?? '');
  const count = activeFilterCount(params);

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    next.delete('page');
    onChange(next);
  };
  const set = (key: string, value: string | null) =>
    update((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
    });

  // Debounced search: update the URL 300 ms after typing stops.
  const urlQ = params.get('q') ?? '';
  useEffect(() => {
    if (q === urlQ) return;
    const t = setTimeout(() => set('q', q.trim() || null), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    setQ(urlQ);
  }, [urlQ]);

  const clearAll = () =>
    update((p) => {
      ['q', 'from', 'to', 'min', 'max', 'category', 'payer', 'participant', 'plan', 'mine', 'deleted', 'group'].forEach((k) => p.delete(k));
    });

  const order = params.get('order') === 'asc' ? 'asc' : 'desc';
  const minError = amountParamError(params.get('min'), decimals);
  const maxError = amountParamError(params.get('max'), decimals);

  const fields: ReactNode = (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
      {groups && (
        <TextField select label="Group" value={params.get('group') ?? ''} onChange={(e) => update((p) => {
          if (e.target.value) p.set('group', e.target.value);
          else p.delete('group');
          p.delete('payer');
          p.delete('participant');
          p.delete('plan');
        })} sx={{ gridColumn: { xs: '1 / -1', md: 'span 2' } }}>
          <MenuItem value="">All groups</MenuItem>
          {groups.map((g) => (
            <MenuItem key={g.id} value={g.id}>
              {g.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField label="From" type="date" value={params.get('from') ?? ''} onChange={(e) => set('from', e.target.value || null)} slotProps={{ inputLabel: { shrink: true } }} />
      <TextField label="To" type="date" value={params.get('to') ?? ''} onChange={(e) => set('to', e.target.value || null)} slotProps={{ inputLabel: { shrink: true } }} />
      <AmountField label="Min amount" value={params.get('min') ?? ''} error={minError} symbol={currencySymbol} onCommit={(v) => set('min', v || null)} />
      <AmountField label="Max amount" value={params.get('max') ?? ''} error={maxError} symbol={currencySymbol} onCommit={(v) => set('max', v || null)} />
      <TextField select label="Category" value={params.get('category') ?? ''} onChange={(e) => set('category', e.target.value || null)}>
        <MenuItem value="">Any category</MenuItem>
        {categories.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {c.label}
          </MenuItem>
        ))}
      </TextField>
      {members && (
        <>
          <TextField select label="Paid by" value={params.get('payer') ?? ''} onChange={(e) => set('payer', e.target.value || null)}>
            <MenuItem value="">Anyone</MenuItem>
            {members.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.isYou ? `${m.displayName} (you)` : m.displayName}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Shared by" value={params.get('participant') ?? ''} onChange={(e) => set('participant', e.target.value || null)}>
            <MenuItem value="">Anyone</MenuItem>
            {members.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.isYou ? `${m.displayName} (you)` : m.displayName}
              </MenuItem>
            ))}
          </TextField>
        </>
      )}
      {plans && plans.length > 0 && (
        <TextField select label="Plan" value={params.get('plan') ?? ''} onChange={(e) => set('plan', e.target.value || null)}>
          <MenuItem value="">Any plan</MenuItem>
          {plans.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.title}
            </MenuItem>
          ))}
        </TextField>
      )}
      <Stack sx={{ gridColumn: '1 / -1' }} direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }}>
        <FormControlLabel
          control={<Switch checked={params.get('mine') === 'true'} onChange={(e) => set('mine', e.target.checked ? 'true' : null)} />}
          label="Only expenses that affect my balance"
        />
        <FormControlLabel control={<Switch checked={params.get('deleted') === 'true'} onChange={(e) => set('deleted', e.target.checked ? 'true' : null)} />} label="Show deleted expenses" />
      </Stack>
    </Box>
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search expenses"
          sx={{ flex: 1, minWidth: 0 }}
          slotProps={{
            htmlInput: { 'aria-label': 'Search expenses', maxLength: 100 },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={17} />
                </InputAdornment>
              ),
              endAdornment: q ? (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="Clear search" onClick={() => setQ('')}>
                    <X size={16} />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
        <Button
          variant={open && !mobile ? 'contained' : 'outlined'}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={count ? `Filters, ${count} active` : 'Filters'}
          startIcon={
            <Badge color="secondary" badgeContent={count} invisible={!count}>
              <Filter size={16} />
            </Badge>
          }
          sx={{ flexShrink: 0, minWidth: { xs: 48, sm: 'auto' }, px: { xs: 1.5, sm: 2 }, '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 } } }}
        >
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            Filters
          </Box>
        </Button>
        <TextField
          select
          value={params.get('sort') ?? 'date'}
          onChange={(e) => set('sort', e.target.value === 'date' ? null : e.target.value)}
          sx={{ width: { xs: 120, sm: 170 }, flexShrink: 0 }}
          slotProps={{ htmlInput: { 'aria-label': 'Sort by' }, select: { renderValue: (v) => `Sort: ${SORTS.find((s) => s.value === v)?.label ?? 'Date'}` } }}
        >
          {SORTS.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title={order === 'asc' ? 'Ascending' : 'Descending'}>
          <IconButton
            onClick={() => set('order', order === 'asc' ? null : 'asc')}
            aria-label={order === 'asc' ? 'Sort ascending (switch to descending)' : 'Sort descending (switch to ascending)'}
            sx={{ border: 1, borderColor: 'divider', flexShrink: 0 }}
          >
            {order === 'asc' ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
          </IconButton>
        </Tooltip>
      </Stack>

      {!mobile && (
        <Collapse in={open} unmountOnExit>
          <Box sx={{ mt: 1.5, p: 2, border: 1, borderColor: 'divider', borderRadius: 3, bgcolor: 'background.paper' }}>
            {fields}
            {count > 0 && (
              <Button size="small" onClick={clearAll} sx={{ mt: 1 }}>
                Clear filters
              </Button>
            )}
          </Box>
        </Collapse>
      )}
      {mobile && (
        <Drawer anchor="bottom" open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85dvh', pb: 'env(safe-area-inset-bottom)' } } }}>
          <Box sx={{ p: 2 }} role="dialog" aria-label="Expense filters">
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
              <Typography variant="h3" component="h2">
                Filters
              </Typography>
              <IconButton aria-label="Close filters" onClick={() => setOpen(false)}>
                <X size={20} />
              </IconButton>
            </Stack>
            {fields}
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button onClick={clearAll} disabled={count === 0} sx={{ flex: 1 }}>
                Clear filters
              </Button>
              <Button variant="contained" onClick={() => setOpen(false)} sx={{ flex: 1 }}>
                Show results
              </Button>
            </Stack>
          </Box>
        </Drawer>
      )}
    </Box>
  );
}

/** Amount input that commits to the URL on blur/Enter (avoids a request per keystroke). */
function AmountField({ label, value, error, symbol, onCommit }: { label: string; value: string; error: string | null; symbol: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onCommit(text.trim());
  return (
    <TextField
      label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      error={!!error}
      helperText={error ?? undefined}
      slotProps={{ htmlInput: { inputMode: 'decimal', className: 'tabular' }, input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> } }}
    />
  );
}
