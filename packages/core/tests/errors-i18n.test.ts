import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import {
  errorLocale,
  knownApiMessage,
  localizeApiError,
} from '../lib/server/errors-i18n.ts';
void test('API locale defaults to English and accepts only the explicit Portuguese cookie', () => {
  for (const cookie of [
    null,
    '',
    'locale=pt-BR',
    'lastfind_locale=pt',
    'lastfind_locale=%70t-BR',
    'lastfind_locale=<script>',
    'lastfind_locale=PT-BR',
  ])
    assert.equal(errorLocale(cookie), 'en');
  assert.equal(
    errorLocale('session=private; lastfind_locale=pt-BR; anything=else'),
    'pt-BR',
  );
  assert.equal(errorLocale('lastfind_locale=en'), 'en');
});
void test('API errors translate both old Portuguese and new English copy without exposing unknown details', () => {
  assert.equal(
    localizeApiError('Projeto não encontrado.', 'en'),
    'Project not found.',
  );
  assert.equal(
    localizeApiError('Project not found.', 'pt-BR'),
    'Projeto não encontrado.',
  );
  assert.equal(
    localizeApiError('Marca: use entre 2 e 80 caracteres.', 'en'),
    'Brand: use between 2 and 80 characters.',
  );
  assert.equal(
    localizeApiError('Claude aceita até 500 caracteres por prompt.', 'en'),
    'Claude accepts up to 500 characters per prompt.',
  );
  assert.equal(
    localizeApiError('Invalid topic filter.', 'pt-BR'),
    'Filtro de tópico inválido.',
  );
  for (const detail of [
    'DataForSEO auth failed: secret=value',
    'D1 SQL failed SELECT private FROM accounts',
    '<script>alert(1)</script>',
    'secret: use entre 2 e 80 caracteres.',
  ]) {
    assert.equal(
      localizeApiError(detail, 'en'),
      'Could not complete this operation. Please try again.',
    );
    assert.equal(
      localizeApiError(detail, 'pt-BR'),
      'Não foi possível concluir a operação. Tente novamente.',
    );
  }
});
void test('Every static API error has English and Portuguese copy', () => {
  const walk = (path: string): string[] =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${path}/${entry.name}`)
        : [`${path}/${entry.name}`],
    );
  const missing: string[] = [];
  for (const file of [
    ...walk(fileURLToPath(new URL('../lib/server', import.meta.url))),
    ...walk(fileURLToPath(new URL('../app/api', import.meta.url))),
  ].filter((path) => path.endsWith('.ts'))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(source) === 'ApiError'
      ) {
        const message = node.arguments?.[1];
        if (
          message &&
          ts.isStringLiteral(message) &&
          !knownApiMessage(message.text)
        )
          missing.push(`${file}: ${message.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, []);
});
