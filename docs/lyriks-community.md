# Lyriks Community

Unspaghettit models how software **behaves**: surfaces, actions, typed state, rules, invariants, scenarios that pass or fail. That is one layer of a specification, and the layer everything else hangs off. It is deliberately not the whole thing. It does not hold who your users are, what a feature must deliver to be accepted, what the screens look like, what the data model is, or whether the product is actually finished.

**Lyriks Community** is the free, self-hosted appliance that holds all of that, with Unspaghettit inside it. It embeds this exact dashboard, this exact engine and these exact JSON models, and wraps the rest of the product specification around them.

Free, one operator, on your own machine. Nothing is taken away from Unspaghettit by installing it: the standalone tool stays exactly what it is, under the same AGPL licence.

## What it adds around the engine

| Layer | What lives there |
| --- | --- |
| **Foundation** | The product brief, its operating guardrails, and the business, market, technical and security constraints it has to hold. |
| **Users** | Personas, roles, and a capability access matrix that says who may do what. |
| **Features** | A feature tree with requirements, acceptance criteria, dependencies, registered evidence, MVP scope and releases. |
| **Experience** | Journeys, screen design, and an experience simulator running on top of your Unspaghettit behavior models. |
| **Behavior** | Unspaghettit itself: the same editor, simulator, model checker, maturity score and coverage index you have here. |
| **System** | Rules, data, architecture, glossary, and one merged knowledge graph across all of it. |
| **Completion** | Traceability, an external-scope coverage ledger, whole-project completion audits, baselines, approvals, and deterministic specification artifacts generated from the model. |
| **Delivery** | A roadmap of releases and sprints, and a sync between the spec and your tracker so a feature becomes tickets and the code coming back updates the spec. |

Everything is one workspace: one login, one MCP endpoint for every AI client, PostgreSQL for the workspace, live sync between people and agents, and backups.

## How it relates to what you already have

- **Same engine.** The appliance installs the published `unspaghettit` package and runs the same dashboard binary. Your models are the same plain JSON snapshots, in the same format.
- **Same MCP vocabulary.** The behavior tools you already prompt with keep working; the appliance adds the workspace tools next to them.
- **Your models move by copy.** The appliance keeps its own snapshot store, so bringing existing work over is a file copy into it (or an export/import through the dashboard), not a migration.
- **Still local.** The appliance runs on your machine or your own server. Nothing is sent anywhere by default.
- **Still yours.** Standalone Unspaghettit remains free and open source under AGPL-3.0, and this page is not a deprecation notice for it.

## Install

Get a free key at [get.lyriks.io](https://get.lyriks.io/). It arrives by email, bound to that address.

```bash
# Linux / macOS
curl -fsSL https://get.lyriks.io | sh
```

```powershell
# Windows, in a NORMAL PowerShell window (not an administrator one)
irm https://get.lyriks.io/windows | iex
```

The command checks the machine, offers to install what is missing (Docker, and WSL2 on Windows), fetches the appliance into `~/lyriks`, installs it, and runs a smoke test before declaring success. Nothing is asked at install time: no account, no key, no email.

Then open `http://localhost:3000` and claim the installation with the email that received the key, the key itself, and a password you choose. Full walkthrough, variants and troubleshooting: [the install guide](https://get.lyriks.io/docs).

## Editions

Community carries a single operator. **Enterprise** adds named members, invitations and RBAC administration, plus the formal DPO analysis engine; it installs in place over a Community appliance, and a key covers its own edition and every edition below it. Ask at `hello@lyriks.io`.

## Turning the offer off

The dashboard shows the Lyriks Community splash on every visit, and only when it is running standalone. Closing the panel hides it for that visit; the button that says "keep using Unspaghettit on its own" retires it for good, and it is the only thing that does. Either way, the app menu (the gear, top right) reopens it.

It never appears when a host product owns the deployment, which is decided by three signals:

- `PUBLIC_UNSPA_HOST_PRODUCT` is set to a non-empty value. Set it to the name of your product when you embed this dashboard in something of your own, and the offer stays hidden for that deployment, whatever URL users reach it by.
- the navigation carries `?brand=<host>`, the host livery marker.
- the document is framed by a host with `?embed=1`.

