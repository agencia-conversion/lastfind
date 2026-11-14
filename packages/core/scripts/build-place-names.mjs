/**
 * Regenerates lib/place-names.json: names of large cities (population over
 * 300,000, plus Brazilian cities over 60,000) and first-level administrative
 * divisions (states, provinces) in 28 languages, from Wikidata (CC0). Countries
 * come from Intl.DisplayNames at run time, so they are not stored.
 * Run: node --experimental-strip-types packages/core/scripts/build-place-names.mjs
 */
import { writeFileSync } from 'node:fs';
import { brandDetectionKey } from '../lib/competitor-discovery.ts';

const LANGS = ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'tr', 'ru', 'uk', 'ar', 'he', 'hi', 'id', 'ja', 'ko', 'zh', 'vi', 'th', 'el', 'ro', 'hu'];
const languages = (list) => list.map((language) => `"${language}"`).join(',');
const queries = [
  `SELECT DISTINCT ?l WHERE { VALUES ?t { wd:Q515 wd:Q1549591 } ?c wdt:P31 ?t; wdt:P1082 ?p. FILTER(?p > 300000) ?c rdfs:label ?l. FILTER(LANG(?l) IN (${languages(LANGS)})) }`,
  `SELECT DISTINCT ?l WHERE { VALUES ?t { wd:Q10864048 wd:Q35657 wd:Q485258 wd:Q11828004 wd:Q5852411 wd:Q1221156 wd:Q107390 } ?c wdt:P31 ?t. ?c rdfs:label ?l. FILTER(LANG(?l) IN (${languages(LANGS)})) }`,
  `SELECT DISTINCT ?l WHERE { VALUES ?t { wd:Q515 wd:Q1549591 } ?c wdt:P31 ?t; wdt:P17 wd:Q155; wdt:P1082 ?p. FILTER(?p > 60000) ?c rdfs:label ?l. FILTER(LANG(?l) IN ("pt","en")) }`,
];
const names = new Set();
for (const query of queries) {
  const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'lastfind-build/1.0', Accept: 'application/sparql-results+json' },
  });
  if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
  for (const binding of (await response.json()).results.bindings) {
    const key = brandDetectionKey(binding.l.value);
    if ((key.length >= 3 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(key)) && key.length <= 40) names.add(key);
  }
}
writeFileSync(new URL('../lib/place-names.json', import.meta.url), `${JSON.stringify([...names].sort())}\n`);
console.log(`${names.size} place names`);
