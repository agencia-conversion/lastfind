import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFanoutNavigation,
  writeFanoutNavigation,
} from '../lib/fanout-navigation.ts';

void test('fan-out history retains a selected query and page 2 with list filters', () => {
  const state = {
    search: 'streaming & vídeo',
    kind: 'site',
    page: 2,
    selected: 'site:example.com vídeo',
    term: 'hulu',
  };
  const detail = new URLSearchParams('project=one&tab=fanout&engine=claude');
  writeFanoutNavigation(detail, state);
  const history = detail.toString();
  // Response URLs have their own parameters; writing them cannot mutate the saved entry.
  const response = new URLSearchParams(history);
  response.set('tab', 'responses');
  writeFanoutNavigation(response, null);
  assert.equal(response.has('fq'), false);
  assert.equal(response.has('fpage'), false);
  assert.deepEqual(readFanoutNavigation(new URLSearchParams(history)), state);
  assert.equal(response.get('project'), 'one');
  assert.equal(response.get('engine'), 'claude');
  // A different project starts without another project's selection or list filters.
  assert.deepEqual(readFanoutNavigation(new URLSearchParams('project=two')), {
    search: '',
    kind: 'all',
    page: 1,
    selected: null,
    term: null,
  });
});

void test('untrusted fan-out URL values cannot create invalid pagination or query types', () => {
  for (const page of [
    '-2',
    '0',
    'NaN',
    '1.5',
    'Infinity',
    '9007199254740992',
  ]) {
    assert.equal(
      readFanoutNavigation(new URLSearchParams({ fpage: page })).page,
      1,
    );
  }
  assert.equal(
    readFanoutNavigation(new URLSearchParams('fkind=unknown')).kind,
    'all',
  );
  const params = new URLSearchParams('fq=old&fsearch=old&fkind=site&fpage=2');
  writeFanoutNavigation(params, readFanoutNavigation(new URLSearchParams()));
  assert.equal(params.toString(), '');
});
