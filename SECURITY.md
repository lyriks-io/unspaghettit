# Security Policy

## Supported versions

Unspaghettit is at `v0.x`. Only the latest `main` is supported with security fixes.

## Reporting a vulnerability

If you find a security issue, **please do not open a public issue**. Instead:

1. Open a private [security advisory](https://github.com/lyriks-io/unspaghettit/security/advisories/new) on GitHub, or
2. Email the maintainer at `adrien.shaolin@gmail.com` with `[unspaghettit security]` in the subject line.

Include:
- A short description of the issue.
- Steps to reproduce.
- The version / commit you tested against.
- Your assessment of impact (data exposure, RCE, DoS, etc.).

You should get an initial reply within 7 days. We'll work with you on a fix, coordinate disclosure timing, and credit you in the changelog unless you prefer to stay anonymous.

## Scope

In scope:
- The MCP server (`mcp-server/`) and its tool surface.
- The CLI (`cli/`) and the files it writes (`.unspa.json`, gitignore blocks, CLAUDE.md/AGENTS.md blocks, client MCP configs).
- The SvelteKit dashboard and its sync endpoints.
- The deterministic simulator.
- Encrypted `.unspa` project bundles (the AES-GCM/PBKDF2 envelope).

Out of scope:
- Vulnerabilities in third-party dependencies (report those upstream).
- Issues that require the attacker to already have write access to the user's local filesystem.
- Configuration mistakes in user-authored feature snapshots.

## Trust model

Unspaghettit is **local-first**. It does not phone home, does not collect telemetry, and does not depend on any hosted service. Every byte of state lives in your repo as plain JSON; the encryption surface (`.unspa` bundles) is opt-in.

### Default tier (loopback, no auth)

This is what you get from a fresh `npm install -g unspaghettit && unspa dashboard` install:

- **Bind**: `127.0.0.1:3000`. The dashboard is only reachable from the same machine.
- **No telemetry**: zero outbound network calls. The only egress is `POST` to `UNSPA_SYNC_URL` (default `http://127.0.0.1:3000/api/sync/reload`); non-loopback overrides are rejected at runtime.
- **No accounts, no auth**: the REST sync routes and the Yjs WebSocket have no authentication. This is intentional — single-machine + loopback means the user IS the trust boundary.
- **DNS-rebinding / CSRF hardening (always on)**: a loopback bind is *not* on its own enough to keep a browser out — a page you visit can rebind its own hostname to `127.0.0.1` and issue same-origin requests at the dashboard. So every `/api/*` request and every WebSocket upgrade must carry a loopback `Host` header (`localhost` / `127.0.0.1` / `[::1]`), and state-changing requests must carry a same-origin (or absent) `Origin`. A rebinding page sends its *own* hostname, so it fails closed with `403`. This guard needs no configuration; add extra hostnames with `UNSPA_ALLOWED_HOSTS=host1,host2` and it steps aside entirely on a wildcard (`--host 0.0.0.0`) bind, where the token below is the intended gate.
- **No path traversal from imports**: every id that becomes an on-disk filename (feature/status/provenance sidecars) is charset-validated, so a hand-crafted `.unspa` bundle can't write outside the snapshot tree.
- **No code execution from snapshots**: feature snapshots are inert data, not executable code.

This tier is appropriate for solo development on a trusted workstation.

### LAN-share tier (shared token + optional origin allowlist)

For sharing the dashboard with teammates on a trusted network (home wifi, office VLAN, Tailscale subnet), set two env vars before launching `unspa dashboard --host 0.0.0.0`:

- `UNSPA_AUTH_TOKEN=<long-random-string>` — every `/api/*` request must carry `Authorization: Bearer <token>`, and every WebSocket upgrade must carry `?token=<token>`. The dashboard returns `401` on a missing/wrong token; the browser surfaces an in-app prompt asking for it. **Set the same value on the MCP server's env** (in `.mcp.json#env` or wherever the MCP gets spawned) — the MCP-to-dashboard `notifySyncReload` reads it and includes the header.
- `UNSPA_ALLOWED_ORIGIN=http://<your-dashboard-host>:<port>` — cross-site browser requests with a mismatching `Origin` header are rejected with `403`. Closes the "malicious page in another tab fetches your localhost dashboard" CSRF class. Server-to-server callers (no `Origin` header) pass through, so the MCP notifier still works.

What this tier covers:
- Anyone who knows the token can read and write every feature on that dashboard.
- Anyone who doesn't know the token can't make any data-plane request.
- A malicious origin loaded in your browser can't drive writes against the dashboard.

What this tier does **not** cover:
- Multi-user roles (everyone with the token has full access).
- HTTPS termination (front the dashboard with a reverse proxy — Caddy + basic auth, Tailscale Serve, cloudflared with Access — for that).
- Audit-trail hardening, account lifecycle, password rotation, encryption at rest.
- Internet exposure. Don't bind `0.0.0.0` on a public IP.

### Backup & share tier (encrypted `.unspa` bundles)

A separate, opt-in surface — orthogonal to the live-dashboard tiers above:

- The **Export `.unspa`** button on the project page bundles the project + every feature + every implementation-status sidecar into a single file and encrypts it client-side with AES-GCM-256 using a key derived from a passphrase via PBKDF2-SHA256 (600 000 iterations, OWASP 2023 minimum).
- The passphrase **never leaves the browser** — the server only sees plaintext bundles during the synchronous fetch + the symmetric import, never the passphrase.
- The envelope carries no identifier of contents (no `projectName`, no metadata) — only the cryptographic params needed to decrypt. A third party holding the file learns it's an Unspaghettit bundle and nothing else.
- Wrong passphrase + tampered ciphertext both fail at AES-GCM's auth-tag check; we never decrypt to garbage.

Threat model for the bundles: passphrase strength is the user's responsibility. The PBKDF2 cost (~1s on a modern CPU) means a 12-char random passphrase is well outside brute-force range; a 6-char dictionary word is not.

## Enterprise tier (separate, on the roadmap)

The OSS install stops at "trust the network, here's a token". A separately-distributed enterprise build covers:

- SSO / SAML / OIDC.
- RBAC with per-project roles.
- Server-side accounts + password reset + rotation.
- Detailed audit trail with PII redaction.
- Multi-tenant isolation.
- Encryption at rest.
- Compliance posture (SOC 2, ISO 27001).

If your install requires any of those, you've outgrown the OSS tier — contact `hello@lyriks.io`.

## Known mitigations (the gaps a researcher would otherwise find)

- A malicious AI client invoking MCP tools with crafted arguments — mitigated by Zod schema validation on every tool input; `generate_types` additionally rejects absolute or `..`-escaping `outputPath` values.
- A prompt-injected `.unspa.json` index pointing the MCP at files outside the repo — mitigated by `resolveIndexFile` in `sync_from_index`, which rejects absolute paths and `..`-escapes.
- A malicious WebSocket peer sending a crafted room id to escape the snapshot directory — mitigated by `parseRoomId` enforcing `[A-Za-z0-9_-]{1,128}` and rejecting every traversal byte; the same charset is re-checked on the `/api/sync/reload` POST handler.
- A malicious `.unspa.json` link pointing the MCP at an unintended folder — mitigated by `discoverRepoLink` walking up from `cwd` only.
- A non-loopback `UNSPA_SYNC_URL` override leaking spec edits to an arbitrary URL — mitigated by `isLoopbackUrl` in `mcp-server/sync-notifier.ts`, which rejects non-loopback hosts at runtime.
- Bearer-token comparison timing leaks — mitigated by `constantTimeEqual` in `src/lib/server/security/auth.ts`.

The `--snapshots` CLI flag and `UNSPA_SNAPSHOTS` env var are user-controlled (not LLM-controlled) and intentionally accept absolute paths so users can host their `unspa/` folder outside the repo.

Found a gap in those? That's exactly what to report.
