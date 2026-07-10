import { get } from 'node:https';
import type { VersionRegistry } from '../application/ports/VersionRegistry';

/**
 * Reads the latest published version from the public npm registry. Hits the
 * lightweight `/<pkg>/latest` endpoint, which returns just the newest version's
 * manifest (not the full packument), and pulls its `version`.
 *
 * This is the one place the update check touches the network, and it does so as
 * a read of public registry data — the request body carries nothing about the
 * user (no identifiers, no telemetry), consistent with the local-first, no-
 * telemetry stance. Fail-silent by contract: every error path (offline, DNS,
 * timeout, non-200, malformed JSON) resolves to `null`, never rejects.
 */
export const npmRegistryVersionSource = (
  opts: { readonly timeoutMs?: number; readonly registryBase?: string } = {}
): VersionRegistry => {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const base = opts.registryBase ?? 'https://registry.npmjs.org';
  return {
    fetchLatest(packageName: string): Promise<string | null> {
      const url = `${base}/${encodeURIComponent(packageName)}/latest`;
      return new Promise((resolve) => {
        let settled = false;
        const done = (value: string | null): void => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const req = get(url, { timeout: timeoutMs }, (res) => {
          if (res.statusCode !== 200) {
            res.resume(); // drain so the socket can be reused/closed
            done(null);
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
            // Guard against a pathological response; the manifest is small.
            if (body.length > 1_000_000) {
              req.destroy();
              done(null);
            }
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body) as { version?: unknown };
              done(typeof parsed.version === 'string' ? parsed.version : null);
            } catch {
              done(null);
            }
          });
        });
        req.on('error', () => done(null));
        req.on('timeout', () => {
          req.destroy();
          done(null);
        });
      });
    }
  };
};
