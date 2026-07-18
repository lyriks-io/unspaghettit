import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearDashboardEndpoint,
  dashboardEndpointFile,
  loopbackUrlFor,
  publishDashboardEndpoint,
  readDashboardEndpoint
} from './dashboardEndpoint';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'unspa-ep-'));
  file = join(dir, '.dashboard.json');
  process.env.UNSPA_DASHBOARD_ENDPOINT_FILE = file;
});

afterEach(() => {
  delete process.env.UNSPA_DASHBOARD_ENDPOINT_FILE;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('dashboardEndpoint rendezvous file', () => {
  it('honours the file-path override', () => {
    expect(dashboardEndpointFile()).toBe(file);
  });

  it('round-trips a published loopback URL', () => {
    publishDashboardEndpoint('http://127.0.0.1:43171');
    expect(readDashboardEndpoint()).toBe('http://127.0.0.1:43171');
  });

  it('returns null when nothing has been published', () => {
    expect(readDashboardEndpoint()).toBeNull();
  });

  it('rejects a non-loopback published URL', () => {
    writeFileSync(file, JSON.stringify({ url: 'http://10.0.0.5:43171', pid: 1, boundAt: 'x' }));
    expect(readDashboardEndpoint()).toBeNull();
  });

  it('strips a trailing slash', () => {
    writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:43171/', pid: 1, boundAt: 'x' }));
    expect(readDashboardEndpoint()).toBe('http://127.0.0.1:43171');
  });

  it('clears only its own entry', () => {
    // Another process's entry is left intact.
    writeFileSync(
      file,
      JSON.stringify({ url: 'http://127.0.0.1:1', pid: process.pid + 1, boundAt: 'x' })
    );
    clearDashboardEndpoint();
    expect(readDashboardEndpoint()).toBe('http://127.0.0.1:1');
    // Our own entry is removed.
    publishDashboardEndpoint('http://127.0.0.1:2');
    clearDashboardEndpoint();
    expect(readDashboardEndpoint()).toBeNull();
  });
});

describe('loopbackUrlFor', () => {
  it('maps a wildcard IPv4 bind to loopback', () => {
    expect(loopbackUrlFor({ address: '0.0.0.0', family: 'IPv4', port: 43171 })).toBe(
      'http://127.0.0.1:43171'
    );
  });

  it('maps a wildcard IPv6 bind to [::1]', () => {
    expect(loopbackUrlFor({ address: '::', family: 'IPv6', port: 8080 })).toBe('http://[::1]:8080');
  });

  it('brackets a specific IPv6 loopback', () => {
    expect(loopbackUrlFor({ address: '::1', family: 'IPv6', port: 5000 })).toBe(
      'http://[::1]:5000'
    );
  });

  it('keeps an explicit IPv4 loopback', () => {
    expect(loopbackUrlFor({ address: '127.0.0.1', family: 'IPv4', port: 3000 })).toBe(
      'http://127.0.0.1:3000'
    );
  });

  it('returns null for a non-loopback LAN bind', () => {
    expect(loopbackUrlFor({ address: '192.168.1.5', family: 'IPv4', port: 3000 })).toBeNull();
  });

  it('returns null for a null / string address', () => {
    expect(loopbackUrlFor(null)).toBeNull();
    expect(loopbackUrlFor('/tmp/some.sock')).toBeNull();
  });
});
