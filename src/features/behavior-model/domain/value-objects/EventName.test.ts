import { describe, expect, it } from 'vitest';
import { asEventName, isEventName } from './EventName';

describe('EventName', () => {
  it('accepts dot-separated lowercase names', () => {
    expect(isEventName('selection.deleted')).toBe(true);
    expect(isEventName('reservation.confirmed')).toBe(true);
    expect(isEventName('selection.delete.blocked')).toBe(true);
  });

  it('rejects names without a dot, with capitals, or with whitespace', () => {
    expect(isEventName('deleted')).toBe(false);
    expect(isEventName('Selection.deleted')).toBe(false);
    expect(isEventName('selection deleted')).toBe(false);
  });

  it('throws on invalid name when constructed', () => {
    expect(() => asEventName('Bad.Name')).toThrow(/Invalid event name/);
  });
});
