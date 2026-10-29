import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, matchPath, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Badge,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  ButtonBase,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  LinearProgress,
} from '@mui/material';
import { LogOut, PanelLeftClose, PanelLeftOpen, Plus, Search, Bell, Settings, Users, Ellipsis, CircleHelp } from 'lucide-react';
import { api, useGroupQuery, useLogoutMutation, useUnreadCountQuery } from '../../api/api';
import { useAuth } from '../../hooks/useAuth';
import { useAppDispatch, useAppSelector } from '../../store';
import { clearToast, openExpenseDialog, setCreateGroupOpen, setSearchOpen, toggleSidebar } from '../../store/ui';
import { MemberAvatar } from '../common/MemberAvatar';
import { isActive, MAIN_NAV, MOBILE_PRIMARY, titleForPath } from './nav';
import { Logo } from './Logo';
import { ExpenseDialog } from '../expenses/ExpenseDialog';
import { SettleDialog } from '../settlements/SettleDialog';
import { CreateGroupDialog } from '../groups/CreateGroupDialog';
import { SearchDialog } from '../search/SearchDialog';
import { TourProvider } from '../tour/TourProvider';

const SIDEBAR_WIDTH = 248;
const navIcon = (to: string) => MAIN_NAV.find((n) => n.to === to)!.icon;
const OverviewIcon = navIcon('/');
const GroupsIcon = navIcon('/groups');
const FriendsIcon = navIcon('/friends');
const SIDEBAR_COLLAPSED = 76;

function useHeaderTitle(): string {
  const { pathname } = useLocation();
  const match = matchPath('/groups/:groupId/*', pathname);
  const groupId = match?.params.groupId;
  const { data } = useGroupQuery(groupId ?? '', { skip: !groupId });
  if (groupId) return data?.group.name ?? 'Group';
  return titleForPath(pathname);
}

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const dispatch = useAppDispatch();
  const { data: unread } = useUnreadCountQuery(undefined, { pollingInterval: 60_000 });
  return (
    <Stack sx={{ height: '100%', py: 2, px: collapsed ? 1.25 : 1.75 }}>
      <Box sx={{ px: collapsed ? 0.5 : 1, mb: 2.5, display: 'flex', justifyContent: collapsed ? 'center' : 'flex-start' }}>
        <RouterLink to="/" onClick={onNavigate} aria-label="ShareSpace home" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Logo compact={collapsed} />
        </RouterLink>
      </Box>
      <Tooltip title={collapsed ? 'Create group' : ''} placement="right">
        <Button
          variant="contained"
          onClick={() => {
            dispatch(setCreateGroupOpen(true));
            onNavigate?.();
          }}
          startIcon={collapsed ? undefined : <Users size={18} />}
          sx={{ mb: 2, minWidth: 0, px: collapsed ? 0 : 2, justifyContent: collapsed ? 'center' : 'flex-start' }}
          aria-label="Create group"
        >
          {collapsed ? <Plus size={20} /> : 'Create group'}
        </Button>
      </Tooltip>
      <List component="nav" aria-label="Main navigation" sx={{ display: 'grid', gap: 0.25 }}>
        {MAIN_NAV.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          const badge = item.to === '/notifications' ? (unread?.unreadCount ?? 0) : 0;
          return (
            <Tooltip key={item.to} title={collapsed ? item.label : ''} placement="right">
              <ListItemButton
                component={RouterLink}
                to={item.to}
                selected={active}
                onClick={onNavigate}
                data-tour={`nav-${item.to.slice(1) || 'overview'}`}
                aria-current={active ? 'page' : undefined}
                sx={{
                  minHeight: 42,
                  px: collapsed ? 0 : 1.5,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  color: active ? 'primary.main' : 'text.primary',
                  '&.Mui-selected': { fontWeight: 700 },
                }}
              >
                <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36, color: active ? 'primary.main' : 'text.secondary' }}>
                  <Badge color="secondary" badgeContent={badge} max={99} invisible={!badge || !collapsed} variant="dot">
                    <Icon size={20} strokeWidth={active ? 2.25 : 1.9} />
                  </Badge>
                </ListItemIcon>
                {!collapsed && (
                  <ListItemText
                    primary={item.label}
                    slotProps={{ primary: { sx: { fontWeight: active ? 700 : 550, fontSize: '0.9rem' } } }}
                  />
                )}
                {!collapsed && badge > 0 && (
                  <Box component="span" sx={{ ml: 1, px: 0.9, borderRadius: 5, fontSize: '0.7rem', fontWeight: 700, bgcolor: 'secondary.main', color: 'secondary.contrastText' }} aria-label={`${badge} unread`}>
                    {badge > 99 ? '99+' : badge}
                  </Box>
                )}
              </ListItemButton>
            </Tooltip>
          );
        })}
      </List>
    </Stack>
  );
}

function UserMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [logout] = useLogoutMutation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!user) return null;
  return (
    <>
      <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Account menu" aria-haspopup="menu" sx={{ p: 0.5 }}>
        <MemberAvatar name={user.name} color={user.avatarColor} size={34} />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ px: 2, py: 1.25, maxWidth: 260 }}>
          <Typography variant="subtitle1" noWrap>
            {user.name}
          </Typography>
          <Typography variant="caption" noWrap component="p">
            {user.email}
          </Typography>
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            navigate('/settings');
          }}
        >
          <ListItemIcon>
            <Settings size={18} />
          </ListItemIcon>
          Settings
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            navigate('/help');
          }}
        >
          <ListItemIcon>
            <CircleHelp size={18} />
          </ListItemIcon>
          Help & guide
        </MenuItem>
        <MenuItem
          onClick={async () => {
            setAnchor(null);
            await logout().unwrap().catch(() => undefined);
            dispatch(api.util.resetApiState());
            navigate('/login', { replace: true });
          }}
        >
          <ListItemIcon>
            <LogOut size={18} />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}

function NotificationButton() {
  const { data } = useUnreadCountQuery(undefined, { pollingInterval: 60_000 });
  const count = data?.unreadCount ?? 0;
  return (
    <Tooltip title="Notifications">
      <IconButton component={RouterLink} to="/notifications" data-tour="notifications" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}>
        <Badge color="secondary" badgeContent={count} max={99}>
          <Bell size={20} />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}

function useGroupIdFromPath(): string | undefined {
  const { pathname } = useLocation();
  return matchPath('/groups/:groupId/*', pathname)?.params.groupId;
}

function useQuickAdd() {
  const dispatch = useAppDispatch();
  const groupId = useGroupIdFromPath();
  return () => dispatch(openExpenseDialog(groupId ? { groupId } : undefined));
}

export function AppShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const collapsed = useAppSelector((s) => s.ui.sidebarCollapsed);
  const toast = useAppSelector((s) => s.ui.toast);
  const dispatch = useAppDispatch();
  const title = useHeaderTitle();
  const quickAdd = useQuickAdd();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH;

  useEffect(() => {
    document.title = title === 'ShareSpace' ? 'ShareSpace' : `${title} · ShareSpace`;
  }, [title]);

  // Keyboard shortcuts: Ctrl/Cmd+K opens search; "/" too, when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        dispatch(setSearchOpen(true));
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        dispatch(setSearchOpen(true));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const mobileValue = MOBILE_PRIMARY.find((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p))) ?? (moreOpen ? 'more' : false);

  return (
    <TourProvider>
      <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {desktop && (
          <Drawer
            variant="permanent"
            sx={{
              width: sidebarWidth,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: sidebarWidth,
                boxSizing: 'border-box',
                borderRight: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                overflowX: 'hidden',
                transition: theme.transitions.create('width', { duration: 180 }),
              },
            }}
          >
            <SidebarContent collapsed={collapsed} />
          </Drawer>
        )}

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <AppBar position="sticky" color="inherit" elevation={0} sx={{ bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider', backdropFilter: 'saturate(1.2)' }}>
            <Toolbar sx={{ gap: 1, minHeight: { xs: 56, md: 64 }, px: { xs: 1.5, md: 3 } }}>
              {desktop ? (
                <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                  <IconButton onClick={() => dispatch(toggleSidebar())} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} edge="start">
                    {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
                  </IconButton>
                </Tooltip>
              ) : (
                <RouterLink to="/" aria-label="ShareSpace home" style={{ display: 'flex', color: 'inherit', textDecoration: 'none' }}>
                  <Logo compact />
                </RouterLink>
              )}
              <Typography variant="h3" component="p" noWrap sx={{ flex: 1, minWidth: 0, ml: { xs: 0.5, md: 0.5 } }}>
                {title}
              </Typography>
              {desktop ? (
                <ButtonBase
                  onClick={() => dispatch(setSearchOpen(true))}
                  aria-label="Search (Ctrl+K)"
                  data-tour="search"
                  sx={{
                    width: { md: 220, lg: 300 },
                    height: 40,
                    px: 1.5,
                    gap: 1,
                    justifyContent: 'flex-start',
                    borderRadius: 2.5,
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    color: 'text.secondary',
                    fontSize: '0.875rem',
                  }}
                >
                  <Search size={17} />
                  <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>
                    Search
                  </Box>
                  <Box component="kbd" sx={{ fontFamily: 'inherit', fontSize: '0.7rem', px: 0.75, py: 0.1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    Ctrl K
                  </Box>
                </ButtonBase>
              ) : (
                <IconButton onClick={() => dispatch(setSearchOpen(true))} aria-label="Search" data-tour="search">
                  <Search size={20} />
                </IconButton>
              )}
              <NotificationButton />
              {desktop && (
                <Button variant="contained" startIcon={<Plus size={18} />} onClick={quickAdd} sx={{ ml: 0.5 }} data-tour="add-expense">
                  Add expense
                </Button>
              )}
              <UserMenu />
            </Toolbar>
          </AppBar>

          <Box
            component="main"
            id="main"
            tabIndex={-1}
            sx={{
              flex: 1,
              width: '100%',
              maxWidth: 1240,
              mx: 'auto',
              px: { xs: 2, sm: 3, md: 4 },
              pt: { xs: 2.5, md: 3.5 },
              pb: { xs: 'calc(96px + env(safe-area-inset-bottom))', md: 6 },
              outline: 'none',
              overflowX: 'clip',
            }}
          >
            <Suspense fallback={<LinearProgress aria-label="Loading page" sx={{ maxWidth: 240, mx: 'auto', mt: 8 }} />}>{children}</Suspense>
          </Box>
        </Box>

        {!desktop && (
          <Paper
            component="nav"
            aria-label="Primary"
            elevation={0}
            sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: (t) => t.zIndex.appBar, borderTop: 1, borderColor: 'divider', pb: 'env(safe-area-inset-bottom)' }}
          >
            <BottomNavigation
              showLabels
              value={mobileValue}
              onChange={(_e, value: string) => {
                if (value === 'add') quickAdd();
                else if (value === 'more') setMoreOpen(true);
                else navigate(value);
              }}
              sx={{ height: 64, bgcolor: 'background.paper', '& .MuiBottomNavigationAction-root': { minWidth: 0, px: 0.5 }, '& .Mui-selected': { fontWeight: 700 } }}
            >
              <BottomNavigationAction label="Overview" value="/" icon={<OverviewIcon size={22} />} />
              <BottomNavigationAction label="Groups" value="/groups" icon={<GroupsIcon size={22} />} data-tour="bottom-groups" />
              <BottomNavigationAction
                label="Add"
                value="add"
                aria-label="Add expense"
                data-tour="bottom-add"
                icon={
                  <Box sx={{ width: 44, height: 44, mt: -0.5, borderRadius: '14px', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText' }}>
                    <Plus size={24} />
                  </Box>
                }
                sx={{ '& .MuiBottomNavigationAction-label': { mt: 0.25 } }}
              />
              <BottomNavigationAction label="Friends" value="/friends" icon={<FriendsIcon size={22} />} data-tour="bottom-friends" />
              <BottomNavigationAction label="More" value="more" icon={<Ellipsis size={22} />} data-tour="more-button" />
            </BottomNavigation>
          </Paper>
        )}

        <Drawer anchor="bottom" open={moreOpen} onClose={() => setMoreOpen(false)} slotProps={{ paper: { sx: { borderTopLeftRadius: 20, borderTopRightRadius: 20, pb: 'env(safe-area-inset-bottom)' } } }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1.25 }} aria-hidden />
          <List sx={{ p: 1.5 }} aria-label="More destinations">
            {MAIN_NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to)).map((item) => (
              <ListItemButton key={item.to} component={RouterLink} to={item.to} onClick={() => setMoreOpen(false)} selected={isActive(item, pathname)} sx={{ minHeight: 48 }}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <item.icon size={20} />
                </ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
            <ListItemButton
              onClick={() => {
                setMoreOpen(false);
                dispatch(setCreateGroupOpen(true));
              }}
              sx={{ minHeight: 48 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Users size={20} />
              </ListItemIcon>
              <ListItemText primary="Create group" />
            </ListItemButton>
          </List>
        </Drawer>

        <ExpenseDialog />
        <SettleDialog />
        <CreateGroupDialog />
        <SearchDialog />
        <Snackbar
          key={toast?.id}
          open={!!toast}
          autoHideDuration={toast?.severity === 'error' ? 6000 : 3500}
          onClose={(_e, reason) => reason !== 'clickaway' && dispatch(clearToast())}
          anchorOrigin={{ vertical: 'bottom', horizontal: desktop ? 'left' : 'center' }}
          sx={{ bottom: { xs: 88, md: 24 } }}
        >
          {toast ? (
            <Alert severity={toast.severity} variant="filled" onClose={() => dispatch(clearToast())} sx={{ width: '100%', bgcolor: toast.severity === 'success' ? 'primary.dark' : undefined }}>
              {toast.message}
            </Alert>
          ) : undefined}
        </Snackbar>
      </Box>
    </TourProvider>
  );
}


