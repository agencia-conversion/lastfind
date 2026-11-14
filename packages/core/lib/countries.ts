// Every country a project can monitor. DataForSEO's country-level `location_code` is 2000 + the ISO 3166-1 numeric
// code (Brazil 2076, United States 2840, United Kingdom 2826). The list is DataForSEO's Google SERP countries (locations
// CSV of 2026-09-01: 213 countries; Russia and Belarus are no longer served). Each entry is the ISO alpha-2 code followed
// by the ISO numeric code. Which AI collects in which country lives in engines.ts (ENGINE_META.countries).
const TABLE = `
AD020 AE784 AF004 AG028 AL008 AM051 AO024 AQ010 AR032 AS016 AT040 AU036 AZ031 BA070 BB052 BD050
BE056 BF854 BG100 BH048 BI108 BJ204 BN096 BO068 BQ535 BR076 BS044 BT064 BW072 BZ084 CA124 CC166
CD180 CF140 CG178 CH756 CI384 CK184 CL152 CM120 CN156 CO170 CR188 CV132 CW531 CX162 CY196 CZ203
DE276 DJ262 DK208 DM212 DO214 DZ012 EC218 EE233 EG818 ER232 ES724 ET231 FI246 FJ242 FM583 FR250
GA266 GB826 GD308 GE268 GG831 GH288 GM270 GN324 GQ226 GR300 GS239 GT320 GU316 GW624 GY328 HM334
HN340 HR191 HT332 HU348 ID360 IE372 IL376 IM833 IN356 IQ368 IS352 IT380 JE832 JM388 JO400 JP392
KE404 KG417 KH116 KI296 KM174 KN659 KR410 KW414 KZ398 LA418 LB422 LC662 LI438 LK144 LR430 LS426
LT440 LU442 LV428 LY434 MA504 MC492 MD498 ME499 MF663 MG450 MH584 MK807 ML466 MM104 MN496 MP580
MR478 MT470 MU480 MV462 MW454 MX484 MY458 MZ508 NA516 NC540 NE562 NF574 NG566 NI558 NL528 NO578
NP524 NR520 NU570 NZ554 OM512 PA591 PE604 PF258 PG598 PH608 PK586 PL616 PM666 PN612 PT620 PW585
PY600 QA634 RO642 RS688 RW646 SA682 SB090 SC690 SE752 SG702 SH654 SI705 SK703 SL694 SM674 SN686
SO706 SR740 ST678 SV222 SX534 SZ748 TD148 TF260 TG768 TH764 TJ762 TK772 TL626 TM795 TN788 TO776
TR792 TT780 TV798 TZ834 UA804 UG800 UM581 US840 UY858 UZ860 VA336 VC670 VE862 VN704 VU548 WF876
WS882 YE887 ZA710 ZM894 ZW716`;
const ISO = new Map(
  TABLE.trim()
    .split(/\s+/)
    .map((entry) => [2000 + Number(entry.slice(2)), entry.slice(0, 2)] as const),
);
export const COUNTRY_CODES: readonly number[] = [...ISO.keys()];
/** The ISO alpha-2 code of a DataForSEO country `location_code`, or undefined when it is not a country we offer. */
export const countryIso = (location: number) => ISO.get(location);
export const isCountryCode = (value: unknown): value is number =>
  typeof value === 'number' && ISO.has(value);

export type CountryLocale = 'en' | 'pt-BR';
const displayNames = new Map<CountryLocale, Intl.DisplayNames>();
/** The country's name in the interface language (CLDR, through Intl). */
export function countryName(location: number, locale: CountryLocale = 'en') {
  const iso = countryIso(location);
  if (!iso) return String(location);
  let names = displayNames.get(locale);
  if (!names) displayNames.set(locale, (names = new Intl.DisplayNames([locale], { type: 'region' })));
  return names.of(iso) ?? iso;
}
/** The flag emoji of a country (two regional indicator letters). */
export const countryFlag = (location: number) =>
  String.fromCodePoint(...[...(countryIso(location) ?? '')].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));
/** Every offered country, sorted by its name in the interface language. */
export const countryOptions = (locale: CountryLocale) =>
  COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );

// Prompts, answers, suggestions, classifiers and the Semantic panel work in Portuguese and English only, so a new
// project starts in Portuguese in a Portuguese-speaking country and in English everywhere else.
const PORTUGUESE = new Set(['AO', 'BR', 'CV', 'GW', 'MZ', 'PT', 'ST', 'TL']);
export const countryLanguage = (location: number): 'pt' | 'en' =>
  PORTUGUESE.has(countryIso(location) ?? '') ? 'pt' : 'en';
