import { describe, expect, it } from 'vitest';
import type { StateDefinition } from '../entities/StateDefinition';
import { writePath, type StateSnapshot } from '../value-objects/StatePath';
import { buildInitialSnapshot } from './StateSnapshot';

const def = (path: string, defaultValue: unknown) => ({ path, defaultValue }) as unknown as StateDefinition;
/** The reference: each default written in turn. */
const oneByOne = (defs: StateDefinition[]): StateSnapshot =>
  defs.reduce<StateSnapshot>((s, d) => writePath(s, d.path, d.defaultValue), {});

describe('the starting state, built once', () => {
  it('equals writing every default in turn, a later path winning over an earlier one', () => {
    const defs = [def('a.b', 1), def('a.c', 'x'), def('d', true), def('a', 5), def('a.e', 2), def('f.g.h', null)];
    expect(buildInitialSnapshot(defs)).toEqual(oneByOne(defs));
  });

  it('never writes into a default that is itself an object', () => {
    const settings = { theme: 'dark' };
    const defs = [def('prefs', settings), def('prefs.size', 3)];
    const built = buildInitialSnapshot(defs);
    expect(built).toEqual(oneByOne(defs));
    expect(settings).toEqual({ theme: 'dark' });
  });
});
