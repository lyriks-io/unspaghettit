/**
 * The language a project's spec is written in. Every text the engine writes
 * about a model (a gap, a finding, a digest line, a scenario's name) follows
 * it; names taken from the model (actions, rules, states, enumeration values)
 * are quoted as they are and never translated. English is the default: a
 * caller that passes nothing reads exactly what it always read.
 */
export type ReportLanguage = 'en' | 'fr';

export const REPORT_LANGUAGES: readonly ReportLanguage[] = ['en', 'fr'];

/** NO-BREAK SPACE: French puts it inside « » and before : ; ! ? */
export const NBSP = ' ';

/**
 * A name from the model, quoted the way the language quotes: "name" in
 * English, « name » in French (no-break spaces inside the guillemets). An
 * empty name reads "un texte vide" in French, never « » around nothing;
 * English keeps its historical `""`.
 */
export const quoteName = (lang: ReportLanguage, name: string): string => {
  if (lang === 'fr') return name.length === 0 ? 'un texte vide' : `«${NBSP}${name}${NBSP}»`;
  return `"${name}"`;
};

/** A number as the language writes it: a decimal comma in French. */
export const numberText = (lang: ReportLanguage, n: number): string =>
  lang === 'fr' ? String(n).replace('.', ',') : String(n);

/** A boolean value as a word of the language. */
export const truthText = (lang: ReportLanguage, value: boolean): string =>
  lang === 'fr' ? (value ? 'vrai' : 'faux') : value ? 'true' : 'false';

/**
 * French punctuation: a no-break space before the high signs (: ; ! ?) and
 * inside guillemets. Plain spaces that stand there are turned into no-break
 * ones; a URL-like `://` and a sign glued to a word are left alone.
 */
export const frenchTypography = (sentence: string): string =>
  sentence
    .replace(/ ([:;!?])(?=\s|$)/g, `${NBSP}$1`)
    .replace(/« /g, `«${NBSP}`)
    .replace(/ »/g, `${NBSP}»`);

/** Picks the text of the language. */
export const pick = <T>(lang: ReportLanguage, en: T, fr: T): T => (lang === 'fr' ? fr : en);

const PROSE_MARKERS: Readonly<Record<ReportLanguage, readonly string[]>> = {
  en: [
    'the',
    'and',
    'is',
    'are',
    'of',
    'to',
    'with',
    'when',
    'which',
    'that',
    'it',
    'for',
    'be',
    'not',
    'can'
  ],
  fr: [
    'le',
    'la',
    'les',
    'des',
    'du',
    'et',
    'est',
    'une',
    'un',
    'pour',
    'dans',
    'avec',
    'qui',
    'que',
    'pas',
    'sont',
    'au',
    'aux',
    'ne'
  ]
};

/**
 * The language most of `texts` is written in, among English and French, or
 * null when there is too little prose to say.
 */
export const proseLanguage = (texts: Iterable<string>): ReportLanguage | null => {
  const count = { en: 0, fr: 0 };
  const sets = { en: new Set(PROSE_MARKERS.en), fr: new Set(PROSE_MARKERS.fr) };
  for (const text of texts) {
    for (const word of text.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ']+/g) ?? []) {
      const bare = word.replace(/^[a-z]'/, '');
      if (sets.en.has(bare)) count.en += 1;
      if (sets.fr.has(bare)) count.fr += 1;
    }
  }
  const total = count.en + count.fr;
  if (total < 8) return null;
  if (count.fr / total >= 0.6) return 'fr';
  if (count.en / total >= 0.6) return 'en';
  return null;
};
