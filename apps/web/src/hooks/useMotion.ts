import { useMediaQuery } from '@mui/material';
import { usePreferences } from './useAuth';

/** True when non-essential motion should be disabled (OS setting or the user's preference). */
export function useReducedMotionPref(): boolean {
  const prefs = usePreferences();
  const osReduce = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });
  if (prefs.motion === 'reduce') return true;
  if (prefs.motion === 'full') return false;
  return osReduce;
}
