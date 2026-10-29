import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { forgotPasswordSchema } from '@sharespace/core';
import { toApiError, useForgotPasswordMutation } from '../../api/api';
import { AuthLayout } from './AuthLayout';

export default function ForgotPassword() {
  const [request, { isLoading }] = useForgotPasswordMutation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await request(values).unwrap();
      setDone(true);
    } catch (e) {
      setError(toApiError(e).message);
    }
  });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email you signed up with."
      footer={
        <Link component={RouterLink} to="/login" variant="body2" fontWeight={600}>
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <Stack spacing={2}>
          <Alert severity="info">
            If an account exists for that email, a password reset link has been created. It is valid for one hour.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Email delivery is not configured on this ShareSpace server, so no email is sent. In a development setup the reset link is printed in the
            server console. Ask your administrator if you need help.
          </Typography>
        </Stack>
      ) : (
        <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" autoFocus {...register('email')} error={!!formState.errors.email} helperText={formState.errors.email?.message} />
          <Button type="submit" variant="contained" size="large" disabled={isLoading}>
            {isLoading ? 'Requesting…' : 'Request reset link'}
          </Button>
        </Stack>
      )}
    </AuthLayout>
  );
}
