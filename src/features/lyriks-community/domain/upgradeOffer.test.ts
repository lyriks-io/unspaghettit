import { describe, expect, it } from 'vitest';
import {
  hostProductName,
  isHostedRuntime,
  shouldShowUpgradeOffer,
  type UpgradeOfferContext
} from './upgradeOffer';

const url = (search = '') => new URL(`https://example.test/projects${search}`);

/** A standalone install, offer never retired, nothing else on screen. */
const standalone = (over: Partial<UpgradeOfferContext> = {}): UpgradeOfferContext => ({
  hostProduct: undefined,
  url: url(),
  optedOut: false,
  dismissedForNow: false,
  reopened: false,
  dialogOpen: false,
  ...over
});

describe('hostProductName', () => {
  it('reads a host name, ignoring surrounding whitespace', () => {
    expect(hostProductName('Lyriks')).toBe('Lyriks');
    expect(hostProductName('  Lyriks  ')).toBe('Lyriks');
  });

  it('treats unset and blank as "no host"', () => {
    expect(hostProductName(undefined)).toBeNull();
    expect(hostProductName(null)).toBeNull();
    expect(hostProductName('')).toBeNull();
    expect(hostProductName('   ')).toBeNull();
  });
});

describe('isHostedRuntime', () => {
  // The appliance case: a Lyriks user opens the behavior editor directly, on
  // its own port or under /behavior, with no query string at all. Only the env
  // var can tell us this deployment is not a standalone install.
  it('is true when the deployment declares a host product', () => {
    expect(isHostedRuntime('Lyriks', url())).toBe(true);
  });

  it('is true when the navigation carries host livery or a host frame', () => {
    expect(isHostedRuntime(undefined, url('?brand=lyriks'))).toBe(true);
    expect(isHostedRuntime(undefined, url('?embed=1'))).toBe(true);
  });

  it('is false for a plain standalone install', () => {
    expect(isHostedRuntime(undefined, url())).toBe(false);
    expect(isHostedRuntime('', url('?theme=lyriks'))).toBe(false);
    expect(isHostedRuntime(undefined, null)).toBe(false);
  });
});

describe('shouldShowUpgradeOffer', () => {
  it('opens on a standalone install', () => {
    expect(shouldShowUpgradeOffer(standalone())).toBe(true);
  });

  // The point of the whole feature: the offer stands until the user says
  // otherwise. Closing the panel is "not now", and a reload clears that.
  it('closing it is only for this visit', () => {
    expect(shouldShowUpgradeOffer(standalone({ dismissedForNow: true }))).toBe(false);
    expect(shouldShowUpgradeOffer(standalone({ dismissedForNow: false }))).toBe(true);
  });

  it('stays closed for good once the user retires it', () => {
    expect(shouldShowUpgradeOffer(standalone({ optedOut: true }))).toBe(false);
    expect(shouldShowUpgradeOffer(standalone({ optedOut: true, dismissedForNow: false }))).toBe(
      false
    );
  });

  // Before localStorage has been read we do not know yet, and guessing "show"
  // would flash the splash at a user who already retired it, on every load.
  it('stays closed until the opt-out flag has hydrated', () => {
    expect(shouldShowUpgradeOffer(standalone({ optedOut: null }))).toBe(false);
  });

  it('reopens on demand from the app menu, whatever the user chose before', () => {
    expect(shouldShowUpgradeOffer(standalone({ optedOut: true, reopened: true }))).toBe(true);
    expect(shouldShowUpgradeOffer(standalone({ dismissedForNow: true, reopened: true }))).toBe(
      true
    );
  });

  // The first-run name prompt owns the screen on the very first visit. Stacking
  // a second modal behind it is what makes an app feel like a popup farm.
  it('waits for any open dialog to close', () => {
    expect(shouldShowUpgradeOffer(standalone({ dialogOpen: true }))).toBe(false);
    expect(shouldShowUpgradeOffer(standalone({ dialogOpen: true, reopened: true }))).toBe(false);
  });

  it('never opens inside a host product, on demand or otherwise', () => {
    expect(shouldShowUpgradeOffer(standalone({ hostProduct: 'Lyriks' }))).toBe(false);
    expect(shouldShowUpgradeOffer(standalone({ url: url('?embed=1') }))).toBe(false);
    expect(shouldShowUpgradeOffer(standalone({ url: url('?brand=lyriks') }))).toBe(false);
    expect(shouldShowUpgradeOffer(standalone({ hostProduct: 'Lyriks', reopened: true }))).toBe(
      false
    );
  });
});
