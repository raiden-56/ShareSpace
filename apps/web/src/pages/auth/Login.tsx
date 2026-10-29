import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Divider, IconButton, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material';
import { Compass, Eye, EyeOff } from 'lucide-react';
import { loginSchema, type LoginInput } from '@sharespace/core';
import { api, toApiError, useLoginMutation } from '../../api/api';
import { enterGuestMode, exitGuestMode, GUEST_MODE_ENABLED } from '../../guest/mode';
import { useAppDispatch } from '../../store';
import { AuthLayout } from './AuthLayout';

export function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [login, { isLoading }] = useLoginMutation();
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const returnTo = safeReturnTo(params.get('returnTo'));
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const [guestLoading, setGuestLoading] = useState(false);

  /** Demo builds only: signs in as the sample user; every request is then answered in the browser. */
  const exploreAsGuest = async () => {
    setError(null);
    setGuestLoading(true);
    enterGuestMode();
    const request = dispatch(api.endpoints.me.initiate(undefined, { forceRefetch: true }));
    try {
      await request.unwrap();
      navigate(returnTo, { replace: true });
    } catch (e) {
      exitGuestMode();
      setError(toApiError(e).message);
      setGuestLoading(false);
    } finally {
      request.unsubscribe();
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const session = await login(values).unwrap();
      await dispatch(api.util.upsertQueryData('me', undefined, session));
      navigate(returnTo, { replace: true });
    } catch (e) {
      setError(toApiError(e).message);
    }
  });

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to see your groups and balances."
      footer={
        <Typography variant="body2" color="text.secondary">
          New to ShareSpace?{' '}
          <Link component={RouterLink} to={`/register${params.toString() ? `?${params}` : ''}`} fontWeight={600}>
            Create an account
          </Link>
        </Typography>
      }
    >
      {GUEST_MODE_ENABLED && (
        <Stack spacing={1} sx={{ mb: 2.5 }}>
          <Button variant="contained" size="large" color="secondary" startIcon={<Compass size={18} />} onClick={() => void exploreAsGuest()} disabled={guestLoading}>
            {guestLoading ? 'Opening the demo…' : 'Explore with demo data'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            No account needed. Try ShareSpace with sample groups and expenses; nothing you change is saved.
          </Typography>
          <Divider sx={{ pt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              or sign in
            </Typography>
          </Divider>
        </Stack>
      )}
      <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus={!GUEST_MODE_ENABLED}
          {...register('email')}
          error={!!formState.errors.email}
          helperText={formState.errors.email?.message}
        />
        <TextField
          label="Password"
          type={show ? 'text' : 'password'}
          autoComplete="current-password"
          {...register('password')}
          error={!!formState.errors.password}
          helperText={formState.errors.password?.message}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} edge="end" size="small">
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ alignSelf: 'flex-end' }}>
          Forgot password?
        </Link>
        <Button type="submit" variant="contained" size="large" disabled={isLoading}>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>
      </Stack>
    </AuthLayout>
  );
}
