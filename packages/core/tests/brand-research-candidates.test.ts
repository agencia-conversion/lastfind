import test from 'node:test';
import assert from 'node:assert/strict';
import { researchInput } from '../lib/brand-research.ts';
import { researchCandidateShortlist } from '../lib/brand-research-candidates.ts';
import { discoverCompetitors } from '../lib/competitor-discovery.ts';
const targets = [
  { name: 'Acme', domain: 'acme.example' },
  { name: 'Nova', domain: 'nova.example' },
];
const prose = [
  'Acme is excellent for small teams. Acme is affordable and easy to use. Orbit is another affordable alternative, with useful collaboration features.',
  'Acme has limited reporting and is not recommended for complex projects. Nova is recommended for advanced reporting. Orbit is an alternative worth comparing.',
  'Acme offers task lists and a calendar. Nova also has a calendar. Orbit is another project-management option with an integrated calendar.',
];
test('a name met only in running text is a review item for discovery and an option for typed review', () => {
  const orbit = discoverCompetitors(
    prose.map((answer, index) => ({
      id: String(index),
      answer,
      sources: [],
      createdAt: '',
    })),
    targets,
  ).find((candidate) => candidate.name === 'Orbit');
  assert.equal(orbit?.ambiguous, true);
  assert.equal(orbit?.answerCount, 3);
  for (const answer of prose)
    assert.ok(
      researchCandidateShortlist(answer, targets).candidates.some(
        (candidate) => candidate.name === 'Orbit',
      ),
    );
});
test('shortlist excludes URL/reference-only names, preserves direct domain evidence and bounds work explicitly', () => {
  const sources = researchCandidateShortlist(
    'Acme is recommended.\n\n## Sources\n- [Publisher](https://publisher.example)\n- https://orbit.example',
    targets,
  );
  assert.equal(
    sources.candidates.some((candidate) =>
      ['Publisher', 'Orbit'].includes(candidate.name),
    ),
    false,
  );
  const linked = researchCandidateShortlist(
    'Compare project tools:\n- **Acme**: project management.\n- [Orbit](https://orbit.example): project management for teams.',
    targets,
  );
  const orbit = linked.candidates.find(
    (candidate) => candidate.name === 'Orbit',
  );
  assert.equal(orbit?.domain, 'orbit.example');
  const long = researchCandidateShortlist(
    prose[0] + 'x'.repeat(17000),
    targets,
  );
  assert.equal(long.fullCoverage, false);
  assert.ok(long.candidates.length <= 10);
});
test('known identities retain their own domain when appended to an unknown-domain surface', () => {
  const list = researchCandidateShortlist(
    'Acme and Orbit are alternatives.',
    targets,
    [{ name: 'Orbit', domain: 'orbit.example' }],
  ).candidates;
  assert.ok(
    list.some(
      (item) => item.name === 'Orbit' && item.domain === 'orbit.example',
    ),
  );
});

test('shortlist-to-evaluation pipeline preserves same-name identities with different domains', () => {
  const answer = 'Acme and Orbit are alternatives.';
  const shortlist = researchCandidateShortlist(answer, targets, [
    { name: 'Orbit', domain: 'orbit.example' },
  ]);
  const input = researchInput(
    answer,
    targets,
    shortlist.candidates,
    'software',
  );
  const orbit = input.options.filter(
    (option) => option.kind === 'candidate' && option.name === 'Orbit',
  );
  assert.equal(orbit.length, 2);
  assert.deepEqual(
    new Set(orbit.map((option) => option.domain)),
    new Set([null, 'orbit.example']),
  );
  assert.equal(new Set(orbit.map((option) => option.id)).size, 2);
});

test('pronouns, sentence grammar and demonyms are never options', () => {
  const text =
    'Acme offers team software. My favorite service lets You watch Japanese films, including *Diners, Drive-Ins and Dives*. It also features comedians like John Mulaney and Ali Wong.';
  const list = researchCandidateShortlist(text, targets, [
    { name: 'Japanese', domain: 'publisher.example' },
    { name: 'John Mulaney', domain: null },
    { name: 'Drive-Ins', domain: null },
  ]).candidates;
  for (const name of ['My', 'You', 'Japanese', 'My favorite service'])
    assert.ok(!list.some((row) => row.name === name), name);
});

test('research carries comparison key and human-review metadata for unresolved spans', () => {
  const list = researchCandidateShortlist(
    'Acme bietet Software für Unternehmen. Auch Orbit bietet Software für Unternehmen.',
    targets,
  ).candidates;
  const orbit = list.find((row) => row.name === 'Orbit');
  assert.ok(orbit);
  assert.equal(orbit.key, 'orbit');
  assert.equal(orbit.ambiguous, true);
  assert.ok(orbit.reasons?.some((reason) => reason.includes('human review required')));
});

test('known prose identities survive when the extractor did not select them', () => {
  for (const text of [
    'Some shoppers still compare it with Sports Direct before buying.',
    'Alguns clientes ainda comparam os preços com Sports Direct antes de comprar.',
  ]) {
    const candidate = researchCandidateShortlist(text, targets, [
      { name: 'Sports Direct', domain: 'sportsdirect.example' },
    ]).candidates.find((row) => row.name === 'Sports Direct' && row.domain === 'sportsdirect.example');
    assert.ok(candidate);
    assert.equal(candidate.domain, 'sportsdirect.example');
    assert.equal(candidate.key, 'sports direct');
    assert.equal(candidate.ambiguous, true);
    assert.ok(candidate.reasons?.length);
  }
});

test('known names the answer does not mention, or only as a word, stay absent', () => {
  const candidates = researchCandidateShortlist(
    'Acme offers software. Many customers compare options.',
    targets,
    [
      { name: 'Many', domain: null },
      { name: 'Absent Brand', domain: 'absent.example' },
    ],
  ).candidates;
  for (const name of ['Many', 'Absent Brand'])
    assert.ok(!candidates.some((row) => row.name === name), name);
});
