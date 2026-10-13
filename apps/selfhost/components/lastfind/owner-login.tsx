'use client';
import { useI18n } from '@/lib/i18n';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestJson } from '@/lib/client';
export function OwnerLogin() {
  const { t } = useI18n();
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestInFlight = useRef(false);
  const keyInput = useRef<HTMLInputElement>(null);
  return (
    <form
      className="lf-form mt-6"
      aria-busy={busy}
      onSubmit={async (e) => {
        e.preventDefault();
        if (requestInFlight.current) return;
        requestInFlight.current = true;
        setBusy(true);
        setError('');
        try {
          await requestJson('/api/auth/login', 'POST', { key });
          const path = window.location.pathname;
          // Retain an owner deep link without accepting an external return URL.
          // Reload also re-runs the server guard for a route with a fragment.
          if (path === '/app' || path.startsWith('/app/'))
            window.location.reload();
          else window.location.assign('/app');
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : t('Não foi possível entrar.'),
          );
          requestInFlight.current = false;
          setBusy(false);
          keyInput.current?.focus();
        }
      }}
    >
      <Label htmlFor="owner-key">
        {t('Chave de acesso da sua instalação')}
      </Label>
      <Input
        ref={keyInput}
        id="owner-key"
        type="password"
        autoComplete="current-password"
        required
        readOnly={busy}
        aria-describedby={`owner-key-hint${error ? ' owner-login-error' : ''}`}
        minLength={32}
        maxLength={256}
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          setError('');
        }}
      />
      <p id="owner-key-hint" className="form-hint">
        {t(
          'Use a chave gerada durante a instalação. Você pode guardá-la no seu gerenciador de senhas.',
        )}
      </p>
      {error && (
        <p id="owner-login-error" className="notice error-notice" role="alert">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="h-[52px] w-full font-semibold"
        disabled={busy}
      >
        {busy ? t('Entrando…') : t('Entrar na minha instalação')}
      </Button>
    </form>
  );
}
