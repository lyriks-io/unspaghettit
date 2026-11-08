/**
 * Requirement sentences read from the behavior model by a fixed template, with
 * no AI: a rule, an always-true statement or a reachability goal reads as one
 * EARS sentence (When / if / then ... shall), a scenario reads as
 * Given / When / Then. A sentence derived from the logic can never contradict
 * it, and every existing spec gets its sentences at once. The template exists
 * in every language the project may declare (English, French): only the
 * skeleton of the sentence is translated. The names the model gives (actions,
 * state paths, events, values, constants, parameters) are code-facing and a
 * French sentence quotes them verbatim, « like.this », as it quotes the
 * messages the end user sees.
 *
 * The sentence exists to be understood without reading the logic, so the
 * template groups what nests (either ... or, numbered alternatives, only if),
 * shows every case of a value chosen case by case, and reads an action name the
 * way a person would write it.
 *
 * The input is the raw snapshot the engine stores, read defensively: an
 * unknown node shape yields a plainer sentence, never an error.
 */

import {
  NBSP,
  numberText,
  proseLanguage,
  quoteName,
  type ReportLanguage as SpecLanguage
} from '$shared/language';

type Node = Record<string, unknown>;
const node = (v: unknown): Node => (v && typeof v === 'object' ? (v as Node) : {});
const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A dotted or camelCase name as lowercase words: `wallet.dailyWithdrawn` reads "wallet daily withdrawn". */
export function words(name: string): string {
  return name
    .split('.')
    .flatMap((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/_+/g, ' ')
        .toLowerCase()
        .split(/\s+/)
    )
    .filter(Boolean)
    .join(' ');
}

/** Named constants of a feature, read with their value. */
export type Constants = Readonly<Record<string, unknown>>;

/** A name of the model, quoted verbatim in a French sentence. */
const quoted = (name: string): string => quoteName('fr', name);

/** What French writes before a colon or a semicolon: a space that never breaks the line. */
const COLON = `${NBSP}:`;
const SEMICOLON = `${NBSP}; `;

const VOWEL = /^[aeiouyàâäéèêëîïôöùûü]/i;

/**
 * A French word before the text that follows it, elided or contracted the way
 * French writes it: "de le" is "du", "à les" is "aux", "que au" is "qu'au",
 * "si il" is "s'il".
 */
function fr(word: 'de' | 'à' | 'que' | 'lorsque' | 'si', text: string): string {
  if (word === 'de' || word === 'à') {
    const [le, les] = word === 'de' ? ['du', 'des'] : ['au', 'aux'];
    if (text.startsWith('le ')) return `${le} ${text.slice(3)}`;
    if (text.startsWith('les ')) return `${les} ${text.slice(4)}`;
    return word === 'de' && VOWEL.test(text) ? `d'${text}` : `${word} ${text}`;
  }
  if (word === 'si') return /^ils?\b/.test(text) ? `s'${text}` : `si ${text}`;
  return VOWEL.test(text) ? `${word.slice(0, -1)}'${text}` : `${word} ${text}`;
}

function literal(value: unknown, lang: SpecLanguage = 'en'): string {
  if (lang === 'fr') {
    // "rien" would read as a value ("ne vaut pas rien" says "is not worthless"):
    // comparisons and assignments with no value have their own wording, and
    // anywhere else the value is named as missing.
    if (value === null || value === undefined) return 'aucune valeur';
    if (typeof value === 'string') return quoted(value);
    if (typeof value === 'boolean') return value ? 'vrai' : 'faux';
    if (typeof value === 'number') return numberText('fr', value);
    if (Array.isArray(value)) {
      if (value.length === 0) return 'une liste vide';
      return value.length === 1
        ? "une liste d'un élément"
        : `une liste de ${value.length} éléments`;
    }
    if (typeof value === 'object') return 'un enregistrement';
    return String(value);
  }
  if (value === null || value === undefined) return 'nothing';
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value))
    return value.length === 0 ? 'an empty list' : `a list of ${value.length}`;
  if (typeof value === 'object') return 'a record';
  return String(value);
}

// Every subject a French condition names is masculine ("le paramètre", "le
// canal", a quoted name), so its verb agrees without guessing a gender.
function inputName(name: string, lang: SpecLanguage): string {
  if (lang === 'fr') return name === '$channel' ? 'le canal' : `le paramètre ${quoted(name)}`;
  return name === '$channel' ? 'the channel' : `the ${words(name)} given`;
}

// ── action names ───────────────────────────────────────────────────────────

/** The key a word is compared under: lower case, without a trailing possessive. */
const nameKey = (word: string): string => word.toLowerCase().replace(/['’]s?$/, '');

/**
 * The proper names the given texts write, as lower-case keys joined by spaces.
 * A run of two or more words capitalised in the middle of a sentence is a name
 * as a whole ("Town Hall", "Ines' Workshop"). A single capitalised word is one
 * only if the texts never write it in lower case: "Level" capitalised once but
 * written "level" elsewhere is a common word.
 */
export function properNamesIn(texts: Iterable<string>): Set<string> {
  const runs: string[][] = [];
  const lowered = new Set<string>();
  for (const text of texts) {
    let run: string[] = [];
    let end = -1;
    const close = () => {
      if (run.length > 0) runs.push(run);
      run = [];
    };
    for (const match of text.matchAll(/[A-Za-z][A-Za-z'’]*/g)) {
      const word = match[0];
      const start = match.index ?? 0;
      // A run only continues over the space between two words.
      if (text.slice(end, start).trim() !== '') close();
      end = start + word.length;
      if (!/^[A-Z]/.test(word)) {
        lowered.add(nameKey(word));
        close();
        continue;
      }
      const before = text.slice(0, start).trimEnd();
      const opensSentence = before === '' || /[.!?:"“]$/.test(before);
      if (opensSentence && run.length === 0) continue;
      run.push(nameKey(word));
    }
    close();
  }
  const names = new Set<string>();
  for (const run of runs) {
    if (run.length > 1) names.add(run.join(' '));
    for (const word of run) if (!lowered.has(word)) names.add(word);
  }
  return names;
}

/** Every prose text of a feature snapshot, where its proper names are written. */
function proseOf(feature: Node): string[] {
  const texts: string[] = [str(feature.description)];
  const collect = (items: Node[]) => {
    for (const item of items) {
      texts.push(str(item.description), str(item.message), str(node(item.effect).reason));
    }
  };
  collect(arr(feature.featureInvariants));
  for (const surface of arr(feature.surfaces)) {
    collect(arr(surface.rules));
    collect(arr(surface.invariants));
    for (const action of arr(surface.actions)) {
      texts.push(str(action.description));
      collect(arr(action.rules));
      collect(arr(action.invariants));
    }
  }
  return texts.filter(Boolean);
}

/** The proper names of one feature snapshot (its `feature` node). */
export function featureProperNames(feature: unknown): Set<string> {
  const f = node(feature);
  // Texts quote the feature's own action and surface names in Title Case
  // ("after Reach New Whole Level"): such a mention names an action, not a
  // place or a person, so it is taken out before reading the names.
  const titles = arr(f.surfaces)
    .flatMap((surface) => [str(surface.name), ...arr(surface.actions).map((a) => str(a.name))])
    .filter((title) => title.includes(' '))
    .sort((a, b) => b.length - a.length);
  const withoutTitles = proseOf(f).map((text) =>
    titles.reduce((t, title) => t.split(title).join(' . '), text)
  );
  return properNamesIn(withoutTitles);
}

/**
 * A name written as one identifier as the words it joins: `searchRooms` reads
 * "search Rooms", `book_room` "book room", `exportPDF` "export PDF". A name that
 * already holds spaces is prose ("Find McDonald") and is left as it is.
 */
function identifierWords(name: string): string {
  if (/\s/.test(name)) return name;
  return name
    .replace(/_+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/**
 * A name of the model as a person reads it when a sentence quotes it: a code
 * identifier (`await_risk_inputs`, `RiskAnalysis`, `collection.completed`,
 * `select-room`) reads as its words, each capitalised ("Await Risk Inputs",
 * "Risk Analysis", "Collection Completed", "Select Room"); a name already
 * written in words is the author's own and is left as it is. Display only:
 * the stored name never changes.
 */
export function readableName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || /\s/.test(trimmed)) return name;
  return identifierWords(trimmed.replace(/[.-]+/g, '_'))
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * An action name as a person writes it inside a sentence: lower case, keeping
 * acronyms ("GPS") and the proper names the feature's own texts capitalise.
 */
export function actionPhrase(name: string, properNames: ReadonlySet<string> = new Set()): string {
  const words = identifierWords(name.trim()).split(/\s+/).filter(Boolean);
  const capitalised = (word: string) => /^[A-Z]/.test(word);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    // The longest run of capitalised words the texts name as a whole.
    let run = 0;
    for (let n = Math.min(4, words.length - i); i > 0 && n > 1 && run === 0; n -= 1) {
      const slice = words.slice(i, i + n);
      if (slice.every(capitalised) && properNames.has(slice.map(nameKey).join(' '))) run = n;
    }
    if (run > 0) {
      out.push(...words.slice(i, i + run));
      i += run;
      continue;
    }
    const word = words[i]!;
    // The first word is the verb: only an acronym keeps its capitals there.
    const keep = /^[A-Z0-9]{2,}$/.test(word) || (i > 0 && properNames.has(nameKey(word)));
    out.push(keep ? word : word.toLowerCase());
    i += 1;
  }
  return out.join(' ');
}

const EVENT_VERBS = new Set([
  'starts',
  'ends',
  'begins',
  'stops',
  'opens',
  'closes',
  'occurs',
  'happens',
  'changes',
  'expires',
  'fails',
  'arrives',
  'completes',
  'finishes',
  'appears',
  'disappears'
]);
const PARTICLES = new Set(['on', 'off', 'up', 'down', 'out', 'in', 'over', 'away', 'back']);

/**
 * An action named like something that happens ("Internet Session Starts",
 * "Reduced Motion Turned On") as the clause it is, or null for an ordinary
 * command name ("Begin Travel", "Record Wages Earned").
 */
export function eventClause(phrase: string): string | null {
  const parts = phrase.split(' ');
  let verb = parts.length - 1;
  while (verb > 0 && PARTICLES.has(parts[verb]!.toLowerCase())) verb -= 1;
  if (verb === 0) return null;
  const word = parts[verb]!.toLowerCase();
  if (EVENT_VERBS.has(word)) return phrase;
  // A participle reads as an event only with its particle ("Turned On"): a
  // bare one is as often a command's object ("Record Wages Earned").
  const particle = verb < parts.length - 1;
  if (particle && word.length > 4 && word.endsWith('ed') && !word.endsWith('eed')) {
    return [...parts.slice(0, verb), 'is', ...parts.slice(verb)].join(' ');
  }
  return null;
}

/** An event name read aloud: `recognition.place_discovered` reads the recognition event "place discovered". */
function eventName(event: string, lang: SpecLanguage = 'en'): string {
  if (lang === 'fr') return `l'événement ${quoted(readableName(event))}`;
  const dot = event.indexOf('.');
  if (dot < 0) return `the event "${words(event)}"`;
  return `the ${words(event.slice(0, dot))} event "${words(event.slice(dot + 1))}"`;
}

// ── expressions ────────────────────────────────────────────────────────────

const ARITHMETIC = new Set(['add', 'sub', 'mul', 'div', 'mod']);

/** An expression read aloud; a computation nested in another is put in parentheses. */
export function expressionText(
  value: unknown,
  constants: Constants = {},
  lang: SpecLanguage = 'en'
): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return literal(value, lang);
  const e = value as Node;
  const side = (v: unknown) => expressionText(v, constants, lang);
  const operand = (v: unknown) => (ARITHMETIC.has(str(node(v).kind)) ? `(${side(v)})` : side(v));
  if (lang === 'fr') return frExpression(e, constants, side, operand);
  switch (e.kind) {
    case 'literal':
      return literal(e.value);
    case 'state':
      return `the ${words(str(e.path))}`;
    case 'param':
      return inputName(str(e.name), 'en');
    case 'const': {
      const name = str(e.name);
      return name in constants
        ? `${name} (${literal(constants[name]).replace(/^"|"$/g, '')})`
        : name;
    }
    case 'add':
      return `${operand(e.left)} plus ${operand(e.right)}`;
    case 'sub':
      return `${operand(e.left)} minus ${operand(e.right)}`;
    case 'mul':
      return `${operand(e.left)} times ${operand(e.right)}`;
    case 'div':
      return `${operand(e.left)} divided by ${operand(e.right)}`;
    case 'mod':
      return `${operand(e.left)} modulo ${operand(e.right)}`;
    case 'min':
      return `the smaller of ${operand(e.left)} and ${operand(e.right)}`;
    case 'max':
      return `the larger of ${operand(e.left)} and ${operand(e.right)}`;
    case 'neg':
      return `minus ${operand(e.operand)}`;
    case 'not':
      return `not ${side(e.operand)}`;
    case 'count':
      return `the number of items in ${side(e.operand)}`;
    case 'sum':
      return `the sum of ${side(e.operand)}`;
    case 'sum_pluck':
      return `the sum of the ${words(str(e.field))} of ${side(e.operand)}`;
    case 'count_where':
      return `the number of items in ${side(e.operand)} that match`;
    case 'switch':
      return switchText(e, constants);
    default:
      return 'a computed value';
  }
}

/** The French reading of an expression node; `side` and `operand` read its parts. */
function frExpression(
  e: Node,
  constants: Constants,
  side: (v: unknown) => string,
  operand: (v: unknown) => string
): string {
  switch (e.kind) {
    case 'literal':
      return literal(e.value, 'fr');
    case 'state':
      return quoted(str(e.path));
    case 'param':
      return inputName(str(e.name), 'fr');
    case 'const': {
      const name = str(e.name);
      if (!(name in constants)) return quoted(name);
      const v = constants[name];
      return `${quoted(name)} (${typeof v === 'string' ? v : literal(v, 'fr')})`;
    }
    case 'add':
      return `${operand(e.left)} plus ${operand(e.right)}`;
    case 'sub':
      return `${operand(e.left)} moins ${operand(e.right)}`;
    case 'mul':
      return `${operand(e.left)} fois ${operand(e.right)}`;
    case 'div':
      return `${operand(e.left)} divisé par ${operand(e.right)}`;
    case 'mod':
      return `${operand(e.left)} modulo ${operand(e.right)}`;
    case 'min':
      return `la plus petite valeur entre ${operand(e.left)} et ${operand(e.right)}`;
    case 'max':
      return `la plus grande valeur entre ${operand(e.left)} et ${operand(e.right)}`;
    case 'neg':
      return `moins ${operand(e.operand)}`;
    case 'not':
      return `la négation ${fr('de', side(e.operand))}`;
    case 'count':
      return `le nombre d'éléments ${fr('de', side(e.operand))}`;
    case 'sum':
      return `la somme ${fr('de', side(e.operand))}`;
    case 'sum_pluck':
      return `la somme des ${quoted(str(e.field))} ${fr('de', side(e.operand))}`;
    case 'count_where':
      return `le nombre d'éléments ${fr('de', side(e.operand))} qui correspondent`;
    case 'switch':
      return switchText(e, constants, 'fr');
    default:
      return 'une valeur calculée';
  }
}

/** A value chosen case by case, every case and the default shown: "(15 if ..., otherwise 0)". */
function switchText(e: Node, constants: Constants, lang: SpecLanguage = 'en'): string {
  const then = (c: Node) => expressionText(c.then, constants, lang);
  const when = (c: Node) => conditionText(c.when, constants, 1, lang);
  if (lang === 'fr') {
    const cases = arr(e.cases).map((c) => `${then(c)} ${fr('si', when(c))}`);
    const otherwise = `sinon ${expressionText(e.default, constants, lang)}`;
    return `(${[...cases, otherwise].join(cases.length > 1 ? SEMICOLON : ', ')})`;
  }
  const cases = arr(e.cases).map((c) => `${then(c)} if ${when(c)}`);
  const otherwise = `otherwise ${expressionText(e.default, constants)}`;
  return `(${[...cases, otherwise].join(cases.length > 1 ? '; ' : ', ')})`;
}

// ── conditions ─────────────────────────────────────────────────────────────

const OPERATORS: Readonly<Record<string, string>> = {
  equals: 'is',
  not_equals: 'is not',
  greater_than: 'is greater than',
  greater_or_equal: 'is at least',
  lower_than: 'is less than',
  lower_or_equal: 'is at most',
  contains: 'contains',
  is_true: 'is true',
  is_false: 'is false',
  exists: 'is set',
  does_not_exist: 'is not set'
};
const FRENCH_OPERATORS: Readonly<Record<string, string>> = {
  equals: 'vaut',
  not_equals: 'ne vaut pas',
  greater_than: 'est supérieur à',
  greater_or_equal: 'est au moins',
  lower_than: 'est inférieur à',
  lower_or_equal: 'est au plus',
  contains: 'contient',
  is_true: 'est vrai',
  is_false: 'est faux',
  exists: 'est renseigné',
  does_not_exist: "n'est pas renseigné"
};
const UNARY = new Set(['is_true', 'is_false', 'exists', 'does_not_exist']);

/** A comparison of a subject with a value already read aloud (empty for a unary operator). */
function comparison(
  subjectText: string,
  operator: string,
  value: string,
  lang: SpecLanguage
): string {
  const verb =
    (lang === 'fr' ? FRENCH_OPERATORS : OPERATORS)[operator] ?? operator.replace(/_/g, ' ');
  if (UNARY.has(operator)) return `${subjectText} ${verb}`;
  // "est supérieur à le paramètre" is written "est supérieur au paramètre".
  if (lang === 'fr' && verb.endsWith(' à'))
    return `${subjectText} ${verb.slice(0, -2)} ${fr('à', value)}`;
  return `${subjectText} ${verb} ${value}`;
}

/** The value a comparison reads when it is a missing or a truth value, else undefined. */
function literalValue(value: unknown): unknown {
  if (value === null || typeof value === 'boolean') return value;
  const v = node(value);
  if (v.kind !== 'literal') return undefined;
  if (v.value === null || v.value === undefined) return null;
  return typeof v.value === 'boolean' ? v.value : undefined;
}

/**
 * A French comparison with a missing or a truth value, worded the way French
 * says it: equal to nothing reads "n'est pas renseigné", equal to true reads
 * "est vrai". Null for any other value, which `comparison` reads.
 */
function frenchSpecialComparison(
  subjectText: string,
  operator: string,
  right: unknown
): string | null {
  if (operator !== 'equals' && operator !== 'not_equals') return null;
  const value = literalValue(right);
  const equals = operator === 'equals';
  if (value === null) return `${subjectText} ${equals ? "n'est pas renseigné" : 'est renseigné'}`;
  if (typeof value !== 'boolean') return null;
  const truth = value ? 'vrai' : 'faux';
  return `${subjectText} ${equals ? `est ${truth}` : `n'est pas ${truth}`}`;
}

/** A comparison of a subject with a value not yet read aloud. */
function comparisonWith(
  subjectText: string,
  operator: string,
  right: unknown,
  read: (value: unknown) => string,
  lang: SpecLanguage
): string {
  const special = lang === 'fr' ? frenchSpecialComparison(subjectText, operator, right) : null;
  return special ?? comparison(subjectText, operator, UNARY.has(operator) ? '' : read(right), lang);
}

/** The opposite comparison, so "A fails" can read as a positive sentence. */
const FLIPPED: Readonly<Record<string, string>> = {
  not_equals: 'equals',
  equals: 'not_equals',
  lower_or_equal: 'greater_than',
  greater_than: 'lower_or_equal',
  lower_than: 'greater_or_equal',
  greater_or_equal: 'lower_than',
  is_true: 'is_false',
  is_false: 'is_true',
  exists: 'does_not_exist',
  does_not_exist: 'exists'
};

const isComposite = (c: Node): boolean => c.kind === 'all' || c.kind === 'any' || c.kind === 'not';

function subject(left: unknown, lang: SpecLanguage): string {
  if (typeof left === 'string') return lang === 'fr' ? quoted(left) : `the ${words(left)}`;
  const l = node(left);
  if (l.kind === 'param') return inputName(str(l.name), lang);
  return lang === 'fr' ? 'le résultat' : 'the value';
}

function leafText(c: Node, constants: Constants, lang: SpecLanguage): string {
  if (c.kind === 'all_match' || c.kind === 'any_match') {
    const every = c.kind === 'all_match';
    if (lang === 'fr') {
      const some = every ? 'chaque élément' : 'au moins un élément';
      return `${some} de ${quoted(str(c.overPath))} correspond`;
    }
    return `${every ? 'every' : 'some'} item of the ${words(str(c.overPath))} matches`;
  }
  return comparisonWith(
    subject(c.left, lang),
    str(c.operator),
    c.right,
    (v) => expressionText(v, constants, lang),
    lang
  );
}

/**
 * A condition that fails, as a positive sentence, or null when it has no simple
 * opposite. An `and` of negative leaves fails when one of them holds, so
 * status is not "raided" and not "dismantled" fails as status is "raided" or
 * "dismantled"; any other `and` would read worse negated and is left alone.
 */
function negated(c: Node, constants: Constants, depth: number, lang: SpecLanguage): string | null {
  if (c.kind === 'not') return conditionText(c.condition, constants, depth, lang);
  if (c.kind === 'all') {
    const parts = arr(c.conditions);
    const flipped = parts.map((p) =>
      isComposite(p) ? null : { ...p, operator: FLIPPED[str(p.operator)] }
    );
    if (parts.length === 0 || flipped.some((p) => !p?.operator || p.operator === 'not_equals'))
      return null;
    return series(alternatives(flipped as Node[], constants, depth, lang), 'or', lang);
  }
  const operator = FLIPPED[str(c.operator)];
  return operator && !isComposite(c) ? leafText({ ...c, operator }, constants, lang) : null;
}

/** Joins a list the way a sentence does: "a", "a or b", "a, b or c" (in French "a, b ou c"). */
function series(
  items: readonly string[],
  conjunction: 'and' | 'or',
  lang: SpecLanguage = 'en'
): string {
  if (items.length <= 1) return items[0] ?? '';
  const word = lang === 'fr' ? (conjunction === 'and' ? 'et' : 'ou') : conjunction;
  return `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}`;
}

/** Alternatives of an `any`, where several values of one subject collapse: is "river", "lake" or "sea". */
function alternatives(
  conditions: Node[],
  constants: Constants,
  depth: number,
  lang: SpecLanguage
): string[] {
  const out: string[] = [];
  // A French missing or truth value has its own wording, so it never joins a list of values.
  const plain = (x: Node) => lang !== 'fr' || literalValue(x.right) === undefined;
  for (let i = 0; i < conditions.length; i += 1) {
    const c = conditions[i]!;
    if (!isComposite(c) && str(c.operator) === 'equals' && typeof c.left === 'string' && plain(c)) {
      const values = [expressionText(c.right, constants, lang)];
      while (
        i + 1 < conditions.length &&
        str(conditions[i + 1]!.operator) === 'equals' &&
        conditions[i + 1]!.left === c.left &&
        plain(conditions[i + 1]!)
      ) {
        i += 1;
        values.push(expressionText(conditions[i]!.right, constants, lang));
      }
      out.push(comparison(subject(c.left, lang), 'equals', series(values, 'or', lang), lang));
      continue;
    }
    out.push(conditionText(c, constants, depth + 1, lang));
  }
  return out;
}

/** One item of a numbered list: an or of two whose first has a simple opposite reads "X only if Y". */
function itemText(c: Node, constants: Constants, lang: SpecLanguage): string {
  const parts = arr(c.conditions);
  if (c.kind === 'any' && parts.length === 2) {
    const premise = negated(parts[0]!, constants, 1, lang);
    if (premise) {
      const onlyIf = conditionText(parts[1], constants, 1, lang);
      return lang === 'fr'
        ? `${premise} seulement ${fr('si', onlyIf)}`
        : `${premise} only if ${onlyIf}`;
    }
  }
  return conditionText(c, constants, 1, lang);
}

const numbered = (items: readonly string[], lang: SpecLanguage): string =>
  items.map((t, i) => `(${i + 1}) ${t}`).join(lang === 'fr' ? SEMICOLON : '; ');

/**
 * A condition read aloud. At the top (depth 0) an `or` of and-groups reads as
 * numbered alternatives and an `and` of several or-groups as a numbered list;
 * nested, an `or` reads "either ... or" ("soit ..., soit ..."), placed last in
 * its `and` so nothing after it can be read as part of it.
 */
export function conditionText(
  condition: unknown,
  constants: Constants = {},
  depth = 0,
  lang: SpecLanguage = 'en'
): string {
  const c = node(condition);
  const french = lang === 'fr';
  if (c.kind === 'not') {
    const inner = conditionText(c.condition, constants, depth + 1, lang);
    return french ? `il n'est pas vrai ${fr('que', inner)}` : `it is not the case that ${inner}`;
  }
  if (c.kind === 'all') {
    const parts = arr(c.conditions);
    const groups = parts.filter(isComposite);
    if (depth === 0 && groups.length >= 2) {
      const list = numbered(
        parts.map((p) => itemText(p, constants, lang)),
        lang
      );
      return french
        ? `toutes ces conditions sont réunies${COLON} ${list}`
        : `all of these hold: ${list}`;
    }
    const leaves = parts.filter((p) => !isComposite(p)).map((p) => leafText(p, constants, lang));
    const nested = groups.map((p) => conditionText(p, constants, depth + 1, lang));
    return series(
      [...leaves, ...(nested.length > 1 ? nested.map((t) => `(${t})`) : nested)],
      'and',
      lang
    );
  }
  if (c.kind === 'any') {
    const parts = arr(c.conditions);
    const items = alternatives(parts, constants, depth, lang);
    // French says "soit a, soit b" for "either a or b".
    const either = (list: string[]) => list.map((t) => `soit ${t}`).join(', ');
    if (parts.some((p) => p.kind === 'all') && items.length > 1) {
      if (depth === 0) {
        const list = numbered(items, lang);
        return french
          ? `l'une de ces conditions est réunie${COLON} ${list}`
          : `one of these holds: ${list}`;
      }
      const grouped = items.map((t) => `(${t})`);
      return french ? either(grouped) : `either ${grouped.join(' or ')}`;
    }
    if (depth > 0 && items.length > 1)
      return french ? either(items) : `either ${series(items, 'or')}`;
    return series(items, 'or', lang);
  }
  return leafText(c, constants, lang);
}

const readsInput = (condition: unknown): boolean =>
  JSON.stringify(condition ?? null).includes('"kind":"param"');

// ── rules ──────────────────────────────────────────────────────────────────

/** Who asks for an action: a person, the system, a schedule, or an event. */
export interface ActionContext {
  readonly name: string;
  readonly actor?: string;
  readonly triggeredByEvent?: string;
  /** Proper names the feature's texts capitalise, kept in the action name. */
  readonly properNames?: ReadonlySet<string>;
}

function asker(action: ActionContext, lang: SpecLanguage = 'en'): string {
  if (lang === 'fr') {
    const who: Readonly<Record<string, string>> = {
      system: 'le système',
      schedule: 'le planificateur',
      event: 'un événement'
    };
    return who[action.actor ?? ''] ?? "l'utilisateur";
  }
  return action.actor === 'system'
    ? 'the system'
    : action.actor === 'schedule'
      ? 'the schedule'
      : action.actor === 'event'
        ? 'an event'
        : 'the user';
}

/** How an action reads in a sentence: its phrase, and the clause when it is named like an event. */
function reading(action: ActionContext): {
  phrase: string;
  clause: string | null;
} {
  const phrase = actionPhrase(action.name, action.properNames);
  return {
    phrase,
    clause: action.triggeredByEvent ? null : eventClause(phrase)
  };
}

function trigger(action: ActionContext): string {
  if (action.triggeredByEvent) return `When ${eventName(action.triggeredByEvent)} occurs`;
  const { phrase, clause } = reading(action);
  return clause ? `When ${clause}` : `When ${asker(action)} asks to ${phrase}`;
}

/** What a rule's effect does, as the object of "shall". */
function response(effect: unknown, action: ActionContext, constants: Constants): string {
  const e = node(effect);
  const { phrase, clause } = reading(action);
  switch (e.type) {
    case 'block_action': {
      const shows = str(e.reason) ? ` and show "${str(e.reason)}"` : '';
      return clause ? `refuse it${shows}` : `refuse to ${phrase}${shows}`;
    }
    case 'allow_action':
      if (clause) return 'allow it';
      return action.triggeredByEvent ? `allow "${phrase}"` : `allow ${asker(action)} to ${phrase}`;
    default:
      return effectText(e, constants, 'en');
  }
}

/** What an effect other than a refusal or a permission does, as the object of "shall" ("doit"). */
function effectText(e: Node, constants: Constants, lang: SpecLanguage): string {
  const path = str(e.path);
  if (lang === 'fr') {
    switch (e.type) {
      case 'set_state':
        if (literalValue(e.value) === null) return `vider ${quoted(path)}`;
        return `mettre ${quoted(path)} ${fr('à', expressionText(e.value, constants, lang))}`;
      case 'emit_event':
        return `émettre ${eventName(str(e.event), lang)}`;
      case 'show_message':
        return `afficher ${quoted(str(e.message))}`;
      case 'transition_surface':
        return 'passer à un autre écran';
      case 'append_to_list':
        return `ajouter un élément à ${quoted(path)}`;
      case 'remove_from_list':
        return `retirer de ${quoted(path)} les éléments qui correspondent`;
      case 'update_list_item':
        return `mettre à jour les éléments de ${quoted(path)} qui correspondent`;
      case 'advance_time':
        return 'laisser passer le temps';
      case 'invoke_operation':
        return str(e.operation) ? `appeler ${quoted(str(e.operation))}` : 'appeler une opération';
      default:
        return str(e.type) ? `appliquer ${quoted(str(e.type))}` : 'agir';
    }
  }
  switch (e.type) {
    case 'set_state':
      return `set the ${words(path)} to ${expressionText(e.value, constants)}`;
    case 'emit_event':
      return `emit ${eventName(str(e.event))}`;
    case 'show_message':
      return `show "${str(e.message)}"`;
    case 'transition_surface':
      return 'move to another screen';
    case 'append_to_list':
      return `add an item to the ${words(path)}`;
    case 'remove_from_list':
      return `remove the matching items from the ${words(path)}`;
    case 'update_list_item':
      return `update the matching items of the ${words(path)}`;
    case 'advance_time':
      return 'let time pass';
    case 'invoke_operation':
      return `call ${str(e.operation) || 'an operation'}`;
    default:
      return str(e.type).replace(/_/g, ' ') || 'act';
  }
}

/**
 * Who or what a French rule is about: an action the sentence names once, then
 * refers to as "la" ("le système doit la refuser"), an action that happens on
 * its own (an event, or named like one) and is named again, or a whole screen.
 */
type FrenchSubject =
  | { readonly kind: 'action'; readonly action: ActionContext }
  | { readonly kind: 'screen'; readonly surfaceName: string };

/** An action named in a French sentence: its name as written, never translated; a code identifier reads in words. */
const frenchAction = (action: ActionContext): string =>
  `l'action ${quoted(readableName(action.name))}`;

/** Whether an action happens rather than being asked for: an event triggers it, or it is named like one. */
const happens = (action: ActionContext): boolean =>
  Boolean(action.triggeredByEvent) || reading(action).clause !== null;

function frenchTrigger(about: FrenchSubject): string {
  if (about.kind === 'screen')
    return `Lorsque l'utilisateur agit sur l'écran ${quoted(readableName(about.surfaceName))}`;
  const { action } = about;
  if (action.triggeredByEvent)
    return `Lorsque ${eventName(action.triggeredByEvent, 'fr')} se produit`;
  if (happens(action)) return `Lorsque ${quoted(readableName(action.name))} se produit`;
  return `${fr('lorsque', asker(action, 'fr'))} déclenche ${frenchAction(action)}`.replace(
    /^l/,
    'L'
  );
}

function frenchResponse(effect: unknown, about: FrenchSubject, constants: Constants): string {
  const e = node(effect);
  const screen = about.kind === 'screen';
  const named = !screen && happens(about.action);
  switch (e.type) {
    case 'block_action': {
      const shows = str(e.reason) ? ` et afficher ${quoted(str(e.reason))}` : '';
      if (screen) return `l'en empêcher${shows}`;
      return `${named ? `refuser ${frenchAction(about.action)}` : 'la refuser'}${shows}`;
    }
    case 'allow_action':
      if (screen) return "l'y autoriser";
      if (named) return `autoriser ${frenchAction(about.action)}`;
      return `permettre ${fr('à', asker(about.action, 'fr'))} de la déclencher`;
    default:
      return effectText(e, constants, 'fr');
  }
}

/** Ends a sentence with a period, unless it already ends on a quoted message that has one. */
const sentence = (text: string): string =>
  /[.!?](?:"|[ \u00a0]?»)$/.test(text) ? text : `${text}.`;

/**
 * A rule as one EARS sentence, in the order a person reads it: the action
 * opens it (When), everything that must hold at that moment follows (if), the
 * effect closes it (then ... shall). A rule is checked when its action is
 * asked for, so the state it reads is an "if" too, never a "While", which
 * would claim a span of time. Within the "if", the state comes before what
 * the caller gives. A surface rule, attached to no action, reads for any
 * action there. In French: Lorsque, si ... alors, le système doit.
 */
export function earsOfRule(
  rule: unknown,
  action: ActionContext | { readonly surfaceName: string },
  constants: Constants = {},
  lang: SpecLanguage = 'en'
): string {
  const r = node(rule);
  const onSurface = 'surfaceName' in action;
  let when: string;
  let shall: string;
  if (lang === 'fr') {
    const about: FrenchSubject = onSurface
      ? { kind: 'screen', surfaceName: action.surfaceName }
      : { kind: 'action', action };
    when = frenchTrigger(about);
    shall = `le système doit ${frenchResponse(r.effect, about, constants)}`;
  } else {
    const screen = onSurface ? readableName(action.surfaceName) : '';
    const context: ActionContext = onSurface
      ? {
          name: `act on the ${screen} screen`,
          properNames: new Set(screen.split(/\s+/).map(nameKey))
        }
      : action;
    when = trigger(context);
    shall = `the system shall ${response(r.effect, onSurface ? { name: 'act there' } : context, constants)}`;
  }
  if (!r.condition) return sentence(`${when}, ${shall}`);
  const c = node(r.condition);
  // Groups go last, so an "either ... or" is never followed by an "and" it could swallow.
  const all = c.kind === 'all' ? arr(c.conditions) : [node(r.condition)];
  const parts = [...all.filter((p) => !isComposite(p)), ...all.filter(isComposite)];
  const depth = parts.length > 1 ? 1 : 0;
  const read = (p: Node) => conditionText(p, constants, depth, lang);
  const ordered = [...parts.filter((p) => !readsInput(p)), ...parts.filter(readsInput)];
  const holds = series(ordered.map(read), 'and', lang);
  if (lang === 'fr') return sentence(`${when}, ${fr('si', holds)}, alors ${shall}`);
  return sentence(`${when}, if ${holds}, then ${shall}`);
}

/**
 * The lead of an action refused under several conditions, read once for all of
 * them: "When the user asks to dive down, the system shall refuse to dive down
 * if any of these holds:". The refusal comes first and the list closes the
 * sentence, right above the lines it announces. Each condition then reads as a
 * `refusalCase`.
 */
export function refusalLead(action: ActionContext, lang: SpecLanguage = 'en'): string {
  if (lang === 'fr') {
    const about: FrenchSubject = { kind: 'action', action };
    const refuse = frenchResponse({ type: 'block_action' }, about, {});
    return `${frenchTrigger(about)}, le système doit ${refuse} si l'une de ces conditions est réunie${COLON}`;
  }
  const { phrase, clause } = reading(action);
  const refuse = clause ? 'refuse it' : `refuse to ${phrase}`;
  return `${trigger(action)}, the system shall ${refuse} if any of these holds:`;
}

/** One condition of a refused action, as it reads under its `refusalLead`. */
export function refusalCase(
  rule: unknown,
  constants: Constants = {},
  lang: SpecLanguage = 'en'
): string {
  return conditionText(node(rule).condition, constants, 1, lang);
}

/** Every state path a condition reads, on either side of a comparison, in order and once each. */
export function statesRead(condition: unknown): string[] {
  const paths = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const v = value as Node;
    if (v.kind === 'state' && typeof v.path === 'string') paths.add(v.path);
    if (typeof v.left === 'string' && 'operator' in v) paths.add(v.left);
    if (typeof v.overPath === 'string') paths.add(v.overPath);
    for (const child of Object.values(v)) if (child && typeof child === 'object') visit(child);
  };
  visit(condition);
  return [...paths];
}

// ── statements and goals ───────────────────────────────────────────────────

/**
 * An always-true statement as EARS: ubiquitous, or state-driven when it is an
 * `or` whose first alternative has a simple opposite: any(A, B, C) holds
 * exactly when, while A fails, B or C holds.
 */
export function earsOfInvariant(
  invariant: unknown,
  constants: Constants = {},
  lang: SpecLanguage = 'en'
): string {
  const condition = node(node(invariant).condition);
  const parts = arr(condition.conditions);
  const french = lang === 'fr';
  if (condition.kind === 'any' && parts.length >= 2) {
    const premise = negated(parts[0]!, constants, 1, lang);
    if (premise) {
      const rest = parts.slice(1);
      const ensured =
        rest.length === 1
          ? conditionText(rest[0], constants, 0, lang)
          : conditionText({ kind: 'any', conditions: rest }, constants, 0, lang);
      return french
        ? `Tant ${fr('que', premise)}, le système doit garantir ${fr('que', ensured)}.`
        : `While ${premise}, the system shall ensure that ${ensured}.`;
    }
  }
  const always = conditionText(condition, constants, 0, lang);
  return french
    ? `Le système doit toujours garantir ${fr('que', always)}.`
    : `The system shall always ensure that ${always}.`;
}

/** A reachability goal as EARS. */
export function earsOfGoal(
  goal: unknown,
  constants: Constants = {},
  lang: SpecLanguage = 'en'
): string {
  const g = node(goal);
  const where = conditionText(g.condition, constants, 1, lang);
  const always = g.kind === 'always_reachable';
  if (lang === 'fr') {
    return always
      ? `Le système doit garder atteignable, depuis tout état, un état où ${where}.`
      : `Le système doit permettre d'atteindre un état où ${where}.`;
  }
  return always
    ? `The system shall keep a state where ${where} reachable from every state.`
    : `The system shall allow a state where ${where} to be reached.`;
}

// ── scenarios ──────────────────────────────────────────────────────────────

/**
 * A scenario as Given / When / Then (in French Étant donné / Quand / Alors),
 * from the state it sets, the steps it plays and what it expects.
 */
export function gwtOfScenario(
  scenario: unknown,
  action: ActionContext,
  actionNames: Readonly<Record<string, string>> = {},
  lang: SpecLanguage = 'en'
): string {
  if (lang === 'fr') return frenchScenario(node(scenario), action, actionNames);
  const s = node(scenario);
  const given = arr(s.stateOverrides).map(
    (o) => `the ${words(str(o.path))} is ${literal(o.value)}`
  );
  const inputs = (list: unknown): string => {
    const set = arr(list).map((p) => `${words(str(p.parameterName))} ${literal(p.value)}`);
    return set.length > 0 ? ` with ${set.join(', ')}` : '';
  };
  const phrase = (name: string) => actionPhrase(name, action.properNames);
  const before = arr(s.steps).map(
    (step) =>
      `${actionNames[str(step.actionId)] ? phrase(actionNames[str(step.actionId)]!) : 'another action'}${inputs(step.parameterOverrides)}`
  );
  const now = `${phrase(action.name)}${inputs(s.parameterOverrides)}`;
  const when =
    before.length > 0
      ? `When the user asks to ${before.join(', then to ')}, then to ${now}`
      : `When the user asks to ${now}`;
  const outcome = str(s.expectedStatus) === 'blocked' ? 'it is refused' : 'it succeeds';
  const expected = arr(s.expectedAssertions).map(
    (a) =>
      `the ${words(str(a.path))} ${OPERATORS[str(a.operator)] ?? str(a.operator)}${UNARY.has(str(a.operator)) ? '' : ` ${literal(a.value)}`}`
  );
  return [
    `Given ${given.length > 0 ? given.join(' and ') : 'the starting state'}`,
    when,
    `Then ${[outcome, ...expected].join(' and ')}`
  ].join('\n');
}

function frenchScenario(
  s: Node,
  action: ActionContext,
  actionNames: Readonly<Record<string, string>>
): string {
  const read = (value: unknown) => literal(value, 'fr');
  const given = arr(s.stateOverrides).map((o) =>
    comparisonWith(quoted(str(o.path)), 'equals', o.value ?? null, read, 'fr')
  );
  const inputs = (list: unknown): string => {
    const set = arr(list).map((p) =>
      p.value === null || p.value === undefined
        ? `${quoted(str(p.parameterName))} non renseigné`
        : `${quoted(str(p.parameterName))} ${fr('à', read(p.value))}`
    );
    return set.length > 0 ? ` avec ${series(set, 'and', 'fr')}` : '';
  };
  const before = arr(s.steps).map((step) => {
    const name = actionNames[str(step.actionId)];
    return `${name ? frenchAction({ name }) : 'une autre action'}${inputs(step.parameterOverrides)}`;
  });
  const now = `${frenchAction(action)}${inputs(s.parameterOverrides)}`;
  const when = `Quand l'utilisateur déclenche ${[...before, now].join(', puis ')}`;
  const outcome = str(s.expectedStatus) === 'blocked' ? "l'action est refusée" : "l'action réussit";
  const expected = arr(s.expectedAssertions).map((a) =>
    comparisonWith(quoted(str(a.path)), str(a.operator), a.value ?? null, read, 'fr')
  );
  // One "que" for the whole list: "Étant donné que A, B et C".
  return [
    given.length > 0
      ? `Étant donné ${fr('que', series(given, 'and', 'fr'))}`
      : "Étant donné l'état initial",
    when,
    `Alors ${series([outcome, ...expected], 'and', 'fr')}`
  ].join('\n');
}

/**
 * Every sentence of one feature snapshot, keyed by element id: rules (action
 * and surface), always-true statements (feature, surface, action), goals and
 * scenarios. Ids repeat only within a kind, so the key is `<kind>:<id>`.
 */
export function featureStatements(
  feature: unknown,
  lang: SpecLanguage = 'en'
): Record<string, string> {
  const f = node(feature);
  const constants: Record<string, unknown> = {};
  for (const c of arr(f.constants)) constants[str(c.name)] = c.value;
  const properNames = featureProperNames(f);
  const out: Record<string, string> = {};
  const actionNames: Record<string, string> = {};
  for (const surface of arr(f.surfaces)) {
    for (const a of arr(surface.actions)) actionNames[str(a.id)] = str(a.name);
  }
  for (const inv of arr(f.featureInvariants))
    out[`invariant:${str(inv.id)}`] = earsOfInvariant(inv, constants, lang);
  for (const goal of arr(f.reachabilityGoals))
    out[`goal:${str(goal.id)}`] = earsOfGoal(goal, constants, lang);
  for (const surface of arr(f.surfaces)) {
    const surfaceName = str(surface.name);
    for (const rule of arr(surface.rules))
      out[`rule:${str(rule.id)}`] = earsOfRule(rule, { surfaceName }, constants, lang);
    for (const inv of arr(surface.invariants))
      out[`invariant:${str(inv.id)}`] = earsOfInvariant(inv, constants, lang);
    for (const a of arr(surface.actions)) {
      const action: ActionContext = {
        name: str(a.name),
        properNames,
        ...(str(a.actor) ? { actor: str(a.actor) } : {}),
        ...(str(a.triggeredByEvent) ? { triggeredByEvent: str(a.triggeredByEvent) } : {})
      };
      for (const rule of arr(a.rules))
        out[`rule:${str(rule.id)}`] = earsOfRule(rule, action, constants, lang);
      for (const inv of arr(a.invariants))
        out[`invariant:${str(inv.id)}`] = earsOfInvariant(inv, constants, lang);
      for (const scenario of arr(a.scenarios)) {
        out[`scenario:${str(scenario.id)}`] = gwtOfScenario(scenario, action, actionNames, lang);
      }
    }
  }
  return out;
}

// ── the editor ─────────────────────────────────────────────────────────────

/**
 * An effect an action applies when it goes through, as EARS: the sentence of
 * an unconditional rule with that effect ("When the user asks to ship the
 * order, the system shall set the order status to "shipped".").
 */
export function earsOfEffect(
  effect: unknown,
  action: ActionContext,
  constants: Constants = {},
  lang: SpecLanguage = 'en'
): string {
  return earsOfRule({ effect }, action, constants, lang);
}

/** The named constants of a feature snapshot, by name. */
export function featureConstants(feature: unknown): Constants {
  const constants: Record<string, unknown> = {};
  for (const c of arr(node(feature).constants)) constants[str(c.name)] = c.value;
  return constants;
}

/**
 * The language a feature's sentences read in when no project declares one:
 * French when its own texts (descriptions, messages) read French, English
 * otherwise.
 */
export function featureLanguage(feature: unknown): SpecLanguage {
  return proseLanguage(proseOf(node(feature))) ?? 'en';
}

/** How a sentence reads who asks for an action, from the action itself. */
export function actionContextOf(
  action: unknown,
  properNames: ReadonlySet<string> = new Set()
): ActionContext {
  const a = node(action);
  return {
    name: str(a.name),
    properNames,
    ...(str(a.actor) ? { actor: str(a.actor) } : {}),
    ...(str(a.triggeredByEvent) ? { triggeredByEvent: str(a.triggeredByEvent) } : {})
  };
}
