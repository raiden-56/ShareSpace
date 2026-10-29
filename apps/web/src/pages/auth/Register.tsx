import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { registerSchema, type RegisterInput } from '@sharespace/core';
import { api, toApiError, useRegisterMutation } from '../../api/api';
import { useAppDispatch } from '../../store';
import { AuthLayout } from './AuthLayout';
import { safeReturnTo } from './Login';

export default function Register() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [registerUser, { isLoading }] = useRegisterMutation();
  const [error, setError] = useState<string | null>(null);
  const returnTo = safeReturnTo(params.get('returnTo'));
  const { register, handleSubmit, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const session = await registerUser(values).unwrap();
      await dispatch(api.util.upsertQueryData('me', undefined, session));
      // Invitation links continue straight to the invite; everyone else starts onboarding.
      navigate(returnTo.startsWith('/invite/') ? returnTo : '/onboarding', { replace: true });
    } catch (e) {
      setError(toApiError(e).message);
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="It takes less than a minute. No payment details needed."
      footer={
        <Typography variant="body2" color="text.secondary">
          Already have an account?{' '}
          <Link component={RouterLink} to={`/login${params.toString() ? `?${params}` : ''}`} fontWeight={600}>
            Sign in
          </Link>
        </Typography>
      }
    >
      <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Your name" autoComplete="name" autoFocus {...register('name')} error={!!formState.errors.name} helperText={formState.errors.name?.message} />
        <TextField label="Email" type="email" autoComplete="email" {...register('email')} error={!!formState.errors.email} helperText={formState.errors.email?.message} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          {...register('password')}
          error={!!formState.errors.password}
          helperText={formState.errors.password?.message ?? 'At least 10 characters, including a letter and a number.'}
        />
        <Button type="submit" variant="contained" size="large" disabled={isLoading}>
          {isLoading ? 'Creating account…' : 'Create account'}
        </Button>
      </Stack>
    </AuthLayout>
  );
}
