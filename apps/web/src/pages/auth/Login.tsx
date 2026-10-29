import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, IconButton, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material';
import { Eye, EyeOff } from 'lucide-react';
import { loginSchema, type LoginInput } from '@sharespace/core';
import { api, toApiError, useLoginMutation } from '../../api/api';
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
      <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
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
