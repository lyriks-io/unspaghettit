# Security

Unspaghettit is local-first by default. Everything lives in your repo: no telemetry, no hosted servers, no callhome. Snapshots are plain JSON.

There are three trust tiers, all opt-in beyond the default.

| Tier | Setup | What it covers |
| --- | --- | --- |
| **Default** | `unspa dashboard` | Loopback bind (`127.0.0.1`, default port `43171`, printed on startup). No auth, no telemetry, no callhome. Single-machine trust boundary, with always-on DNS-rebinding/CSRF hardening (`Host` + write-`Origin` validation) so a page in your browser can't drive the local API. |
| **LAN-share** | `UNSPA_AUTH_TOKEN=<secret>`, optionally `UNSPA_ALLOWED_ORIGIN=http://host:43171`, then `unspa dashboard --host 0.0.0.0` | Every REST and WebSocket request requires the token. The origin allowlist closes browser-side CSRF. Set the same `UNSPA_AUTH_TOKEN` on the MCP server's env so its notify calls authenticate. The dashboard prints the auth posture in its startup banner. |
| **Backup / share** (orthogonal to live sharing) | Click **Export .unspa** on a project, enter a passphrase of 8 or more characters | AES-GCM-256 with PBKDF2-SHA256 (600k iterations). The passphrase never leaves the browser. The envelope carries no project name or metadata. |

The full threat model and mitigations live in [SECURITY.md](../SECURITY.md).

## Enterprise

For SSO, RBAC, audit trails, and encryption at rest, the open-source install stops at the LAN-share tier. Those features are a separate enterprise build. Reach out at `hello@lyriks.io`.
