import { useMemo } from 'react';
import { DEFAULT_PREFERENCES, formatMoney, type FormatOptions, type Preferences } from '@sharespace/core';
import { useMeQuery } from '../api/api';
import { formatDate, formatDateTime, formatRelativeDay } from '../lib/format';

export function useAuth() {
  const { data, isLoading, isFetching, isError, refetch } = useMeQuery();
  return {
    user: data?.user ?? null,
    preferences: data?.preferences ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}

export function usePreferences(): Preferences {
  const { preferences } = useAuth();
  return preferences ?? DEFAULT_PREFERENCES;
}

/** Formatting helpers bound to the signed-in user's regional preferences. */
export function useFormat() {
  const prefs = usePreferences();
  return useMemo(
    () => ({
      money: (minor: number, currency: string, options?: FormatOptions) => formatMoney(minor, currency, options),
      date: (value: string | null | undefined) => formatDate(value, prefs.dateFormat),
      dateTime: (value: string) => formatDateTime(value, prefs.dateFormat),
      day: (value: string) => formatRelativeDay(value, prefs.dateFormat),
      dateFormat: prefs.dateFormat,
    }),
    [prefs.dateFormat],
  );
}
