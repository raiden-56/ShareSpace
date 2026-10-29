import { useNavigate } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Compass } from 'lucide-react';
import { api, useLogoutMutation } from '../api/api';
import { useAppDispatch } from '../store';
import { isGuestActive } from './mode';

/** Slim bar shown above the app while exploring with sample data. */
export function GuestBanner() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [logout, { isLoading }] = useLogoutMutation();
  if (!isGuestActive()) return null;

  const exit = async () => {
    await logout().unwrap().catch(() => undefined);
    dispatch(api.util.resetApiState());
    navigate('/login', { replace: true });
  };

  return (
    <Box role="status" sx={{ bgcolor: 'secondary.main', color: 'secondary.contrastText', px: { xs: 1.5, md: 3 }, py: 0.5 }}>
      <Stack direction="row" spacing={1} useFlexGap alignItems="center" justifyContent="center" sx={{ flexWrap: 'wrap', rowGap: 0 }}>
        <Compass size={15} aria-hidden />
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'inherit' }}>
          Guest mode – sample data, changes aren't saved
        </Typography>
        <Button size="small" color="inherit" onClick={() => void exit()} disabled={isLoading} sx={{ minHeight: 0, py: 0, px: 1, fontSize: '0.75rem', textDecoration: 'underline' }}>
          Exit demo
        </Button>
      </Stack>
    </Box>
  );
}
