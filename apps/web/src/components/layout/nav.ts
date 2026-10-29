import {
  Bell,
  CalendarDays,
  ChartColumn,
  HandCoins,
  LayoutDashboard,
  Receipt,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Match nested routes (e.g. /groups/abc). */
  matchPrefix?: boolean;
}

export const MAIN_NAV: NavItem[] = [
  { label: 'Overview', to: '/', icon: LayoutDashboard },
  { label: 'My Groups', to: '/groups', icon: Users, matchPrefix: true },
  { label: 'Expenses', to: '/expenses', icon: Receipt },
  { label: 'Settlements', to: '/settlements', icon: HandCoins },
  { label: 'Plans & Events', to: '/plans', icon: CalendarDays },
  { label: 'Reports', to: '/reports', icon: ChartColumn },
  { label: 'Notifications', to: '/notifications', icon: Bell },
  { label: 'Settings', to: '/settings', icon: Settings },
];

/** Bottom navigation on mobile: the most frequent destinations; the rest live under "More". */
export const MOBILE_PRIMARY = ['/', '/groups', '/settlements'];

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  return item.matchPrefix ? pathname === item.to || pathname.startsWith(`${item.to}/`) : pathname.startsWith(item.to);
}

export function titleForPath(pathname: string): string {
  const found = MAIN_NAV.find((n) => isActive(n, pathname));
  return found?.label ?? 'ShareSpace';
}
