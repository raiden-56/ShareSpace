import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  CircularProgress,
  Dialog,
  InputAdornment,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { CalendarDays, HandCoins, Receipt, Search, User, Users, Vote, type LucideIcon } from 'lucide-react';
import { useSearchQuery } from '../../api/api';
import type { SearchHit, SearchResponse } from '../../api/types';
import { useAppDispatch, useAppSelector } from '../../store';
import { setSearchOpen } from '../../store/ui';

const SECTIONS: { key: keyof SearchResponse['results']; label: string; icon: LucideIcon }[] = [
  { key: 'groups', label: 'Groups', icon: Users },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
  { key: 'members', label: 'Members', icon: User },
  { key: 'settlements', label: 'Settlements', icon: HandCoins },
  { key: 'plans', label: 'Plans', icon: CalendarDays },
  { key: 'polls', label: 'Polls', icon: Vote },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Global search across every group the user can access, grouped by type, with keyboard navigation. */
export function SearchDialog() {
  const open = useAppSelector((s) => s.ui.searchOpen);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query.trim(), 200);
  const { data, isFetching } = useSearchQuery(debounced, { skip: !open || debounced.length < 2 });

  const flat = useMemo(() => {
    if (!data || data.query !== debounced) return [] as (SearchHit & { section: string; icon: LucideIcon })[];
    return SECTIONS.flatMap((s) => data.results[s.key].map((hit) => ({ ...hit, section: s.label, icon: s.icon })));
  }, [data, debounced]);

  useEffect(() => setActive(0), [debounced]);

  const close = () => dispatch(setSearchOpen(false));
  const go = (hit: SearchHit) => {
    close();
    navigate(hit.link);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      go(flat[active]);
    }
  };

  const activeId = flat[active] ? `search-option-${active}` : undefined;
  let index = -1;

  return (
    <Dialog
      open={open}
      onClose={close}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
      aria-label="Search"
      TransitionProps={{ onExited: () => setQuery('') }}
      slotProps={{ paper: { sx: { alignSelf: { sm: 'flex-start' }, mt: { sm: 10 } } } }}
    >
      <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <InputBase
          autoFocus
          fullWidth
          placeholder="Search groups, expenses, people, plans…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          inputProps={{
            role: 'combobox',
            'aria-expanded': flat.length > 0,
            'aria-controls': 'search-results',
            'aria-activedescendant': activeId,
            'aria-label': 'Search',
            'aria-autocomplete': 'list',
          }}
          startAdornment={
            <InputAdornment position="start">
              <Search size={20} />
            </InputAdornment>
          }
          endAdornment={isFetching ? <CircularProgress size={18} aria-label="Searching" /> : null}
          sx={{ fontSize: '1rem', minHeight: 44 }}
        />
      </Box>
      <Box sx={{ maxHeight: { sm: 440 }, overflowY: 'auto' }}>
        {debounced.length < 2 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            Type at least two characters. Use ↑ ↓ to move and Enter to open.
          </Typography>
        ) : flat.length === 0 && !isFetching && data?.query === debounced ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            No results for “{debounced}” in your groups.
          </Typography>
        ) : (
          <List id="search-results" role="listbox" aria-label="Search results" dense sx={{ py: 0 }}>
            {SECTIONS.map((s) => {
              const hits = flat.filter((h) => h.section === s.label);
              if (hits.length === 0) return null;
              return (
                <Box key={s.key} component="li" sx={{ listStyle: 'none' }}>
                  <ListSubheader component="div" sx={{ lineHeight: '32px', fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', bgcolor: 'background.paper' }}>
                    {s.label}
                  </ListSubheader>
                  <List disablePadding>
                    {hits.map((hit) => {
                      index += 1;
                      const i = index;
                      const Icon = hit.icon;
                      return (
                        <ListItemButton
                          key={`${s.key}-${hit.id}`}
                          id={`search-option-${i}`}
                          role="option"
                          aria-selected={i === active}
                          selected={i === active}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => go(hit)}
                          sx={{ mx: 1, minHeight: 48 }}
                        >
                          <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
                            <Icon size={18} />
                          </ListItemIcon>
                          <ListItemText primary={hit.title} secondary={hit.subtitle} slotProps={{ primary: { noWrap: true, sx: { fontWeight: 600 } }, secondary: { noWrap: true } }} />
                        </ListItemButton>
                      );
                    })}
                  </List>
                </Box>
              );
            })}
          </List>
        )}
      </Box>
    </Dialog>
  );
}
