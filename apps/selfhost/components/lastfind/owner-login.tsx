'use client';
import { useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestJson } from '@/lib/client';
export function OwnerLogin() {
  const { t } = useI18n();
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="lf-form mt-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await requestJson('/api/auth/login', 'POST', { key });
          window.location.assign('/app');
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : t('Não foi possível entrar.'),
          );
          setBusy(false);
        }
      }}
    >
      <Label htmlFor="owner-key">
        {t('Chave de acesso da sua instalação')}
      </Label>
      <Input
        id="owner-key"
        type="password"
        autoComplete="current-password"
        required
        minLength={32}
        maxLength={256}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <p className="form-hint">
        {t(
          'Use a chave gerada durante a instalação. Você pode guardá-la no seu gerenciador de senhas.',
        )}
      </p>
      {error && (
        <p className="notice error-notice" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t('Entrando…') : t('Entrar na minha instalação')}
      </Button>
    </form>
  );
}
