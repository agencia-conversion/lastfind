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
test('typed review receives prose candidates below the autonomous model cutoff without changing that cutoff', () => {
  assert.equal(
    discoverCompetitors(
      prose.map((answer, index) => ({
        id: String(index),
        answer,
        sources: [],
        createdAt: '',
      })),
      targets,
    ).some((candidate) => candidate.name === 'Orbit'),
    false,
  );
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
