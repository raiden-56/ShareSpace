import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { passwordSchema } from '@sharespace/core';
import { toApiError, useResetPasswordMutation } from '../../api/api';
import { AuthLayout } from './AuthLayout';

const formSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [reset, { isLoading }] = useResetPasswordMutation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await reset({ token, password }).unwrap();
      setDone(true);
    } catch (e) {
      setError(toApiError(e).message);
    }
  });

  return (
    <AuthLayout
      title="Choose a new password"
      footer={
        <Link component={RouterLink} to="/login" variant="body2" fontWeight={600}>
          Back to sign in
        </Link>
      }
    >
      {!token ? (
        <Alert severity="error">This reset link is incomplete. Request a new one from the sign-in page.</Alert>
      ) : done ? (
        <Stack spacing={2}>
          <Alert severity="success">Your password has been changed. For your security, all sessions were signed out.</Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Sign in
          </Button>
        </Stack>
      ) : (
        <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="New password" type="password" autoComplete="new-password" autoFocus {...register('password')} error={!!formState.errors.password} helperText={formState.errors.password?.message ?? 'At least 10 characters, including a letter and a number.'} />
          <TextField label="Confirm password" type="password" autoComplete="new-password" {...register('confirm')} error={!!formState.errors.confirm} helperText={formState.errors.confirm?.message} />
          <Button type="submit" variant="contained" size="large" disabled={isLoading}>
            {isLoading ? 'Saving…' : 'Set new password'}
          </Button>
        </Stack>
      )}
    </AuthLayout>
  );
}
