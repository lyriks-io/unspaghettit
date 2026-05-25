/**
 * Domain rule for "did the user type the name we asked for?". Used both
 * by the submit guard (to disable the form's submit button) and by the
 * tour-step advance matchers (to refuse advancing on a side-effect
 * whose payload name doesn't match).
 *
 * Comparison policy:
 *   - trimmed (the form handlers already trim before emitting; we trim
 *     both sides defensively so the guard agrees on the same value)
 *   - case-insensitive (asking the user to match capitalisation is too
 *     pedantic; "Hello world" reads as "Hello World" to a human and
 *     blocking the submit on that frustrates the tutorial)
 *
 * Kept as a single function so any future change to the matching rule
 * (e.g. unicode normalisation, fuzzy matching, locale-aware compare)
 * is a one-line edit that propagates everywhere automatically.
 */
export const isNameMatch = (typed: string, expected: string): boolean =>
  typed.trim().toLowerCase() === expected.trim().toLowerCase();
