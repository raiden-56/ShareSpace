import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useUpdatePreferencesMutation } from '../../api/api';
import { useAuth, usePreferences } from '../../hooks/useAuth';
import { useReducedMotionPref } from '../../hooks/useMotion';
import { TourContext, type TourControls } from './tourContext';
import { TourOverlay } from './TourOverlay';
import { TOUR_STEPS, type TourStep } from './tourSteps';

/** Delay before the first-visit tour starts, so the Overview page has rendered underneath it. */
const AUTO_START_MS = 700;

/**
 * Guided tooltip tour of the app shell. It starts once by itself for a signed-in user who has
 * finished onboarding but not seen the tour, when they land on Overview. Finishing or skipping
 * stores `tourCompleted` in their preferences; `useTour().start()` replays it at any time.
 */
export function TourProvider({ children, steps = TOUR_STEPS }: { children: ReactNode; steps?: TourStep[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const { user } = useAuth();
  const prefs = usePreferences();
  const { pathname } = useLocation();
  const reduceMotion = useReducedMotionPref();
  const [updatePreferences] = useUpdatePreferencesMutation();
  const autoStarted = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  const start = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
  }, []);

  const close = useCallback(() => {
    setIndex(null);
    if (!prefs.tourCompleted) {
      // A failed save only means the tour may be offered again next time.
      updatePreferences({ tourCompleted: true }).unwrap().catch(() => undefined);
    }
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && document.contains(el)) setTimeout(() => el.focus(), 0);
  }, [prefs.tourCompleted, updatePreferences]);

  useEffect(() => {
    if (autoStarted.current || index !== null) return;
    if (!user || !prefs.onboardingCompleted || prefs.tourCompleted || pathname !== '/') return;
    const timer = setTimeout(() => {
      autoStarted.current = true;
      start();
    }, AUTO_START_MS);
    return () => clearTimeout(timer);
  }, [user, prefs.onboardingCompleted, prefs.tourCompleted, pathname, index, start]);

  const controls = useMemo<TourControls>(() => ({ start, active: index !== null }), [start, index]);
  const step = index === null ? undefined : steps[index];

  return (
    <TourContext.Provider value={controls}>
      {children}
      {step && index !== null && (
        <TourOverlay
          step={step}
          index={index}
          total={steps.length}
          reduceMotion={reduceMotion}
          onBack={() => setIndex((i) => (i === null ? i : Math.max(0, i - 1)))}
          onNext={() => (index >= steps.length - 1 ? close() : setIndex(index + 1))}
          onSkip={close}
        />
      )}
    </TourContext.Provider>
  );
}
