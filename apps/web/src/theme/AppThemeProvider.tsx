import { useMemo, type ReactNode } from 'react';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { MotionConfig } from 'framer-motion';
import { usePreferences } from '../hooks/useAuth';
import { useReducedMotionPref } from '../hooks/useMotion';
import { buildTheme } from './theme';

/** Applies the user's theme (light/dark/system) and motion preferences app-wide. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const prefs = usePreferences();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const reduceMotion = useReducedMotionPref();
  const mode = prefs.theme === 'system' ? (prefersDark ? 'dark' : 'light') : prefs.theme;
  const theme = useMemo(() => buildTheme(mode, reduceMotion), [mode, reduceMotion]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>{children}</MotionConfig>
    </ThemeProvider>
  );
}
