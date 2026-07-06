import { afterEach, describe, expect, it } from 'vitest';
import {
  currentActiveUser,
  recordIdentity,
  releaseIdentity,
  resetIdentityRegistry
} from './identityRegistry';

afterEach(() => {
  resetIdentityRegistry();
});

describe('identityRegistry', () => {
  it('returns null when nothing is registered', () => {
    expect(currentActiveUser()).toBeNull();
  });

  it('records a named user and returns them as the current active user', () => {
    recordIdentity('John');
    expect(currentActiveUser()).toBe('John');
  });

  it('ignores anonymous tags so MCP attribution stays meaningful', () => {
    recordIdentity('Anon-1234');
    expect(currentActiveUser()).toBeNull();
  });

  it('ignores the client-side "Anonymous" default (no display name set)', () => {
    recordIdentity('Anonymous');
    expect(currentActiveUser()).toBeNull();
  });

  it('ignores empty strings', () => {
    recordIdentity('');
    expect(currentActiveUser()).toBeNull();
  });

  it('returns the most recently registered user when several are connected', () => {
    recordIdentity('John');
    recordIdentity('Mary');
    expect(currentActiveUser()).toBe('Mary');
  });

  it('re-registering an existing name moves it to the front', () => {
    recordIdentity('John');
    recordIdentity('Mary');
    recordIdentity('John'); // John opens a second tab; should become current
    expect(currentActiveUser()).toBe('John');
  });

  it('reference-counts so the second tab closing keeps the user registered', () => {
    recordIdentity('John'); // tab 1
    recordIdentity('John'); // tab 2
    releaseIdentity('John'); // tab 1 closes
    expect(currentActiveUser()).toBe('John');
    releaseIdentity('John'); // tab 2 closes
    expect(currentActiveUser()).toBeNull();
  });

  it('falls back to the second-newest user when the newest disconnects', () => {
    recordIdentity('John');
    recordIdentity('Mary');
    releaseIdentity('Mary');
    expect(currentActiveUser()).toBe('John');
  });

  it('release on an unknown name is a no-op', () => {
    recordIdentity('John');
    releaseIdentity('Ghost');
    expect(currentActiveUser()).toBe('John');
  });
});
