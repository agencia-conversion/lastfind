import type { ApiLocale } from '@/lib/server/errors-i18n';
// The setup wizard's own messages (server/setup.ts, app/api/setup): the independent edition only.
const messages: Record<string, string> = {
  'This installation already has an admin. Sign in with its access key.': 'Esta instalação já tem um admin. Entre com a chave de acesso dele.',
  'Setup is already finished. Change these settings in Admin.': 'A configuração já terminou. Mude estes ajustes no Admin.',
  'Enter a valid email.': 'Informe um e-mail válido.',
  'Use an access key of 32 to 256 characters.': 'Use uma chave de acesso de 32 a 256 caracteres.',
  'This installation has no SESSION_SECRET. Set it as a Worker secret and open this page again.': 'Esta instalação não tem SESSION_SECRET. Defina-o como secret do Worker e abra esta página de novo.',
  'Unknown setup action.': 'Ação de configuração desconhecida.',
  'Enter the setup token of this installation.': 'Informe o token de configuração desta instalação.',
  'Too many wrong setup tokens. Try again in 15 minutes.': 'Tokens de configuração errados demais. Tente de novo em 15 minutos.',
};
export function editionError(message: string, locale: ApiLocale): string | null {
  if (!(message in messages)) return null;
  return locale === 'pt-BR' ? messages[message] : message;
}
