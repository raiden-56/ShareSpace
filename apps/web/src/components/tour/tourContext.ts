import { createContext, useContext } from 'react';

export interface TourControls {
  /** Starts the guided tour from the first step. */
  start: () => void;
  active: boolean;
}

export const TourContext = createContext<TourControls | null>(null);

/** Start the guided tour from anywhere inside the app shell (Help page, Settings). */
export function useTour(): TourControls {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>');
  return ctx;
}
