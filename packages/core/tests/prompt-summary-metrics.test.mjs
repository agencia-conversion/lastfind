import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { weightedMentionPosition } from '../lib/prompt-summary-metrics.ts';

describe('weightedMentionPosition', () => {
  it('weights by mentions and ignores prompts without a mention', () => {
    // 2.0×10 + 4.0×30 = 140 over 40 mentions → 3.5; the zero-mention row is skipped
    assert.equal(
      weightedMentionPosition([
        { position: 2, mentions: 10 },
        { position: 4, mentions: 30 },
        { position: 1, mentions: 0 },
        { position: null, mentions: 5 },
      ]),
      3.5,
    );
  });

  it('weights by the answers the position was measured in when known, as the Overview does', () => {
    // 2.0×4 + 4.0×1 = 12 over 5 measured answers, though the mentions are 10 and 30
    assert.equal(weightedMentionPosition([{ position: 2, mentions: 10, positionSamples: 4 }, { position: 4, mentions: 30, positionSamples: 1 }]), 2.4);
  });

  it('returns null when nothing qualifies', () => {
    assert.equal(weightedMentionPosition([]), null);
    assert.equal(weightedMentionPosition([{ position: 2, mentions: 0 }]), null);
    assert.equal(weightedMentionPosition([{ position: null, mentions: 3 }]), null);
  });
});
