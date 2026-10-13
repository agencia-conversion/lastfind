# Competitor discovery model reproduction

The runtime uses two portable logistic-regression artifacts. Python is required only to fit and evaluate them; Cloud and self-hosted inference remain TypeScript-only.

Create an isolated Python environment and install the closed dependency set:

```sh
python3 -m venv .venv
.venv/bin/pip install -r packages/core/scripts/competitor-discovery-requirements.txt
```

Only run the pipeline after the corpus annotations and connected-component split are reviewed. R8 fitting used an explicit train/validation-only copy while the replacement test stayed in independent QA custody. The resulting parameters and thresholds were frozen before QA appended the sealed test metadata and label-blind scores:

```sh
node --experimental-strip-types packages/core/scripts/generate-competitor-entity-role-primitives.ts
.venv/bin/python packages/core/scripts/train-competitor-entity-role.py
node --experimental-strip-types packages/core/scripts/generate-competitor-discovery-r6-training.ts
.venv/bin/python packages/core/scripts/train-competitor-discovery.py
```

The span trainer uses fold-local vocabularies and grouped out-of-fold scores for train. Its R7 configuration is `C=0.8`, `class_weight=None`, and fold-local sample weights. For each fit fold, `g_y=N/(2*N_y)`. When a token-length bucket contains both labels, `m_yb=clip((N_b/(2*N_yb))/g_y,1/8,8)`; otherwise `m_yb=1`. The effective weight is `g_y*m_yb*1.5` for an explicitly annotated negative boundary and `g_y*m_yb` otherwise, then all weights are normalized to global mean one. The final fit recomputes this formula from train only. Candidate-surface, prefix and suffix features are excluded from every fold vocabulary and rejected by the runtime artifact validator.

Entity-role context uses the immediate neighbors of each candidate span. Zone length, span-to-zone fraction, adjacent-token casing consistency and table-column relations remain separate signals. Table relations compare a candidate cell with seed cells in the same contiguous table and measure value repetition in its column; they do not depend on header words or an absolute column number. The ranker schema has 18 features, including bounded `distinct_link_domains_per_surface`, `link_label_only`, `mwis_primary_fraction`, and `primary_context_similarity`. The origin fraction is the count of explicitly MWIS-primary spans divided by the candidate's complete bounded feed length; missing origins never count as primary. The interaction is exactly `mwis_primary_fraction * context_similarity`, so the learned ranker can distinguish contextual similarity on primary spans from the same signal on zone recovery without a name rule.

Ranker schema 6 retains schema 5's `entity_role` transform, `clip((z-zLo)/(zHi-zLo),0,1)`, where `z` is the raw logit from the same occurrence selected by the unchanged utility. Schema 5 rankers fail closed because they lack the primary-context interaction. The frozen bounds are the 1st and 99th percentiles of the 4,907 OOF TRAIN logits using NumPy's linear percentile method, rounded to six decimals: `zLo=-11.366828` and `zHi=3.849201`. The role artifact, score artifact, vectors and ranker provenance carry identical versioned metadata; missing, invalid or mismatched metadata fails closed. This transform is excluded from the role parameter projection because it does not change span scoring or decoding, but it is included in the complete ranker/evaluation configuration.

The ranker feed preserves MWIS-primary spans before bounded per-zone recovery, records the origin and score of every selected span, and never applies the role cutoff before the ranker. If test rows are present, the primitive generator writes `label: "sealed"` with empty strata for every enumerated test span and does not use test annotations or declared positives for component identity, feature generation or train/validation audits. The span trainer scores those rows with the final train-only model without consulting labels, the aggregate generator preserves `label: "sealed"`, and the ranker trainer still reads labels only from train and validation.

Each extraction processes at most the first 20 answers, applying that cap before trimming or feature generation. The known 30-answer HTTP fixture remains unchanged; its final ten answers are recorded as cap omissions in the feed audit rather than removed from the training input. Recovery uses the highest raw entity-role logit per empty zone, deterministic span ties, and only the capacity left after retained MWIS primaries. The generated vectors and ranker provenance record proposal counts by selection origin, cutoff, overlap, answer cap and final ranker label.

After both artifacts and thresholds are frozen, the independent QA custodian may add a replacement test and run the evaluator once. The producer must not access that test before freeze:

```sh
.venv/bin/python packages/core/scripts/evaluate-competitor-discovery.py
```

The evaluator decodes every sealed test span. Its conditional entity-role metrics use only explicit binary annotations; its end-to-end metrics use the complete, exact `declaredPositiveSpans`, retain missing enumerations as false negatives, and count every selected span outside the declared positive gold as a false positive. Annotation coverage and selections without an explicit annotation are reported separately. Positive annotations must equal the declared positive spans, offsets are checked as UTF-16, and primitive/score IDs must be unique with complete score coverage.

The checked-in `competitor-discovery-test-evaluation-r8.json` is immutable history for the completed R8 evaluation `r6-282039ac4ecaf3b9`; it is not the active schema 6 tracker. The active ranker records `testEvaluationCount: 0`, meaning no formal sealed evaluation of this configuration. It does not mean that public regression or external QA fixtures were never executed. A future formal evaluation must use a new tracker path and may only append metadata after the public configuration is frozen. The role artifact retains its historical R8 evaluation metadata because its scoring parameters were reused unchanged; the evaluator does not overwrite that history with a ranker evaluation.

The CI repair kept explicit fit history: one initial interrupted attempt with indeterminate in-memory fit count, then four paired candidate invocations with two computational fits each (selected candidate plus matched diagnostic ablation), for eight confirmed fits. The final schema 6 invocation compares the 18-feature candidate with a matched 17-feature ablation that removes only `primary_context_similarity`; it does not restore the earlier context representations. `provenance.fitAccounting` describes the two fits made by the invocation that produced the active artifact.

The observed R6 direct and HTTP fixtures are R7 replay data. New-only R7 components use `SHA-256("lastfind-r7-split-v1:" + canonicalComponentId)`: the first eight hexadecimal digits are parsed as an unsigned integer, modulo five equal to zero selects validation, and all other values select train. Components touching the preserved base inherit its existing partition. The resulting validation partition has no positive three-token spans; do not reroll the split to change that limitation.

For a future governed dataset version, regenerate each pre-evaluation artifact twice into temporary paths and compare bytes before its one test evaluation. Use `--validate-only` to verify the complete corpus/source/primitive/score/vector/parameter chain without reading gold, calculating metrics, or creating a tracker. Validate TypeScript/Python parity, the combined runtime-model size, both editions and the publication inventory before committing. These synthetic agent-labeled metrics are regression evidence; they are neither human annotation nor field-performance estimates.
