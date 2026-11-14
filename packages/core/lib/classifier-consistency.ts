/**
 * The "10x" check: classifying the same thing ten or more times must give the same answer. Pure measures over
 * repeated runs of the three classifiers: brand extraction (free; repeats and other page orders of the same answers),
 * sentiment (paid; `repeatSentiment` takes the caller's `send`, a mock in tests, and a spending cap) and source types (the
 * free rules; the model's repeats are measured with the same `agreement`).
 */
import { classifyBrandSentiment, RESEARCH_RESERVE_USD } from './brand-research-provider.ts';
import { sentimentBand } from './brand-research.ts';
import {
  lowercaseUse,
  mergeNameTally,
  resolveNames,
  tallyName,
  tallyNames,
  type CompetitorCandidate,
  type DiscoveryAnswer,
  type DiscoverySeed,
  type NameTally,
} from './competitor-discovery.ts';
import type { BrandTarget } from './types.ts';

/** Per item, the share of runs that gave its most frequent answer; `identical` items got one answer in every run. */
export function agreement(runs: ReadonlyMap<string, string>[]) {
  const ids = [...new Set(runs.flatMap((run) => [...run.keys()]))].sort();
  const rows = ids.map((id) => {
    const counts = new Map<string, number>();
    for (const run of runs) counts.set(run.get(id) ?? 'missing', (counts.get(run.get(id) ?? 'missing') ?? 0) + 1);
    const top = Math.max(...counts.values());
    return { id, share: top / runs.length, answers: [...counts].sort((a, b) => b[1] - a[1]).map(([answer, count]) => `${answer} ${count}`).join(', ') };
  });
  return {
    items: rows.length,
    identical: rows.filter((row) => row.share === 1).length,
    mean: rows.length ? rows.reduce((sum, row) => sum + row.share, 0) / rows.length : 1,
    unstable: rows.filter((row) => row.share < 1).sort((a, b) => a.share - b.share),
  };
}

/** What the project store does with a window of answers (structure-v7): tally page by page, add the tallies up, resolve once. */
export function discoverPaged(answers: DiscoveryAnswer[], seeds: DiscoverySeed[], pageSize = 10): CompetitorCandidate[] {
  const sum = new Map<string, NameTally>();
  const named = [];
  for (let at = 0; at < answers.length; at += pageSize) {
    const page = tallyNames(answers.slice(at, at + pageSize), seeds);
    for (const tally of page.names) sum.set(tally.key, sum.has(tally.key) ? mergeNameTally(sum.get(tally.key)!, tally) : tally);
    named.push(...page.answers);
  }
  const tallies = [...sum.values()];
  const lowercase = lowercaseUse(answers.map((answer) => answer.answer), tallies.map((tally) => ({ key: tally.key, name: tallyName(tally) })));
  return resolveNames(tallies, named, seeds, lowercase);
}

/** A fixed shuffle (the same seed gives the same order), so a report can be repeated. */
export function shuffled<T>(items: T[], seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

/**
 * Brand extraction, `runs` times on the same answers in the same order (repeats) and `runs` times in other orders, paged
 * as the store pages them (shuffles). Per brand with `minAnswers` or more: the same count, name and aliases in every run.
 */
export function extractionConsistency(answers: DiscoveryAnswer[], seeds: DiscoverySeed[], options: { runs?: number; pageSize?: number; minAnswers?: number } = {}) {
  const { runs = 10, pageSize = 10, minAnswers = 10 } = options;
  const view = (list: CompetitorCandidate[]) =>
    new Map(list.map((candidate) => [candidate.key ?? candidate.name, `${candidate.name} | ${candidate.answerCount} | ${candidate.domain ?? '-'} | ${[...(candidate.aliases ?? [])].sort().join(', ')}`]));
  const started = performance.now();
  const repeats = Array.from({ length: runs }, () => view(discoverPaged(answers, seeds, pageSize)));
  const pass = (performance.now() - started) / runs;
  const orders = Array.from({ length: runs }, (_, index) => view(discoverPaged(index ? shuffled(answers, index) : answers, seeds, pageSize)));
  const measure = (list: Map<string, string>[]) => {
    const big = new Set(list.flatMap((run) => [...run].filter(([, line]) => Number(line.split(' | ')[1]) >= minAnswers).map(([key]) => key)));
    const brands = agreement(list.map((run) => new Map([...run].filter(([key]) => big.has(key)))));
    const whole = new Set(list.map((run) => JSON.stringify([...run].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))))).size;
    return { brands: brands.items, identical: brands.identical, unstable: brands.unstable, outputs: whole };
  };
  return { answers: answers.length, runs, pageSize, minAnswers, msPerPass: Math.round(pass), repeats: measure(repeats), orders: measure(orders) };
}

type SentimentInput = { id: string; question: string; answer: string; brands: BrandTarget[]; category?: string };
/** Spending of a paid check: a call is sent only while what was spent plus its worst case stays under the cap. */
export type Budget = { cap: number; spent: number; calls: number; stopped: boolean };

/**
 * Sentiment, `runs` times on each input (one call per answer and run, as production makes it). A brand's reading is its
 * 0–100 score and the criteria met (`70 praised+recommended`), or its state when the model gave none. A call whose cost is
 * unknown counts at its reserve.
 */
export async function repeatSentiment(
  inputs: SentimentInput[],
  options: { runs: number; budget: Budget; send: (payload: unknown) => Promise<Response>; model?: string },
) {
  const runs: Map<string, string>[] = [];
  const failures: string[] = [];
  // Every request that leaves counts: a reading without probabilities is asked up to three times (steadySentiment).
  const send = (payload: unknown) => {
    options.budget.calls++;
    return options.send(payload);
  };
  for (let run = 0; run < options.runs; run++) {
    const readings = new Map<string, string>();
    for (const input of inputs) {
      if (options.budget.spent + RESEARCH_RESERVE_USD > options.budget.cap) {
        options.budget.stopped = true;
        break;
      }
      try {
        const result = await classifyBrandSentiment(input, { send, ...(options.model ? { model: options.model } : {}) });
        options.budget.spent += result.cost ?? RESEARCH_RESERVE_USD;
        for (const brand of result.brands)
          readings.set(
            `${input.id} | ${brand.brand}`,
            brand.score === null ? brand.state : `${brand.score} ${Object.keys(brand.criteria ?? {}).sort().join('+')}`.trim(),
          );
      } catch (error) {
        options.budget.spent += RESEARCH_RESERVE_USD;
        failures.push(`${input.id}: ${(error as Error).message}`);
      }
    }
    if (options.budget.stopped) break;
    runs.push(readings);
  }
  return { runs, failures, ...sentimentConsistency(runs) };
}

/**
 * Per answer and brand over the runs: the same criteria every time (so the same score), the same score, the same band, and
 * the widest spread in points. A reading is `<score> <criteria>` or a state.
 */
export function sentimentConsistency(runs: ReadonlyMap<string, string>[]) {
  const criteria = agreement(runs);
  const scoreOf = (value: string) => /^\d+/u.exec(value)?.[0];
  const view = (as: (value: string) => string) => runs.map((run) => new Map([...run].map(([id, value]) => [id, as(value)])));
  const scores = agreement(view((value) => scoreOf(value) ?? value));
  const bands = agreement(view((value) => (scoreOf(value) ? sentimentBand(Number(scoreOf(value))) : value)));
  const spreads = new Map<string, number>();
  for (const id of new Set(runs.flatMap((run) => [...run.keys()]))) {
    const values = runs.flatMap((run) => (scoreOf(run.get(id) ?? '') ? [Number(scoreOf(run.get(id)!))] : []));
    if (values.length) spreads.set(id, Math.max(...values) - Math.min(...values));
  }
  return {
    readings: criteria.items,
    sameCriteria: criteria.identical,
    sameScore: scores.identical,
    sameBand: bands.identical,
    maxSpread: Math.max(0, ...spreads.values()),
    unstable: criteria.unstable,
  };
}

/** The same measures for each brand (a reading's id is `<answer> | <brand>`), in name order. */
export function sentimentByBrand(runs: ReadonlyMap<string, string>[]) {
  const brandOf = (id: string) => id.slice(id.indexOf(' | ') + 3);
  const brands = [...new Set(runs.flatMap((run) => [...run.keys()].map(brandOf)))].sort();
  return brands.map((brand) => ({ brand, ...sentimentConsistency(runs.map((run) => new Map([...run].filter(([id]) => brandOf(id) === brand)))) }));
}
