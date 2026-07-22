import { describe, expect, it } from 'vitest';
import { addTag, humanizeTagText, normalizeTags, removeTag, renameTagInList, tagKey } from './Tags';

describe('normalizeTags', () => {
  it('stores authored casing byte-for-byte', () => {
    // The Lyriks platform keys its Features projection off exact tag values
    // (core / family / phase). Lowercasing on write silently emptied it.
    expect(normalizeTags([{ type: 'core', value: 'Data Model' }])).toEqual([
      { type: 'core', value: 'Data Model' }
    ]);
    expect(normalizeTags([{ type: 'Team', value: 'GTM' }])).toEqual([
      { type: 'Team', value: 'GTM' }
    ]);
  });

  it('trims surrounding whitespace but nothing else', () => {
    expect(normalizeTags([{ type: '  Team  ', value: '  Growth  ' }])).toEqual([
      { type: 'Team', value: 'Growth' }
    ]);
  });

  it('dedupes case-insensitively and keeps the first spelling', () => {
    expect(
      normalizeTags([
        { type: 'Team', value: 'Growth' },
        { type: 'team', value: 'GROWTH' }
      ])
    ).toEqual([{ type: 'Team', value: 'Growth' }]);
  });

  it('drops empty type or value and collapses to undefined', () => {
    expect(normalizeTags([{ type: '', value: 'x' }])).toBeUndefined();
    expect(normalizeTags([{ type: 'x', value: '   ' }])).toBeUndefined();
    expect(normalizeTags([])).toBeUndefined();
  });

  it('folds the legacy single-tag fields in without lowercasing them', () => {
    expect(normalizeTags(undefined, { type: 'Domain', value: 'Commerce' })).toEqual([
      { type: 'Domain', value: 'Commerce' }
    ]);
    expect(normalizeTags(undefined, { value: 'Commerce' })).toEqual([
      { type: 'tag', value: 'Commerce' }
    ]);
  });
});

describe('tag identity', () => {
  it('is case-insensitive', () => {
    expect(tagKey({ type: 'Team', value: 'Growth' })).toBe(
      tagKey({ type: 'team', value: 'growth' })
    );
  });

  it('makes addTag idempotent across casings without rewriting the stored value', () => {
    const first = addTag(undefined, { type: 'Core', value: 'Billing' });
    expect(first).toEqual([{ type: 'Core', value: 'Billing' }]);
    expect(addTag(first, { type: 'core', value: 'billing' })).toEqual([
      { type: 'Core', value: 'Billing' }
    ]);
  });

  it('makes removeTag match regardless of casing', () => {
    const tags = [{ type: 'Core', value: 'Billing' }];
    expect(removeTag(tags, { type: 'core', value: 'BILLING' })).toBeUndefined();
  });

  it('renames by case-insensitive match and writes the new casing', () => {
    const tags = [{ type: 'Core', value: 'Billing' }];
    expect(
      renameTagInList(tags, { type: 'core', value: 'billing' }, { type: 'Core', value: 'Payments' })
    ).toEqual([{ type: 'Core', value: 'Payments' }]);
  });
});

describe('humanizeTagText', () => {
  it('title-cases all-lowercase fragments', () => {
    expect(humanizeTagText('user_role')).toBe('User Role');
    expect(humanizeTagText('user-role')).toBe('User Role');
  });

  it('leaves an already-cased fragment alone', () => {
    expect(humanizeTagText('MCP')).toBe('MCP');
    expect(humanizeTagText('dataModel')).toBe('dataModel');
    expect(humanizeTagText('Data Model')).toBe('Data Model');
  });
});
