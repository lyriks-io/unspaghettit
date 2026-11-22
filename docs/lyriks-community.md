# Lyriks Community

Unspaghettit models how software **behaves**: surfaces, actions, typed state, rules, invariants, scenarios that pass or fail. That is one layer of a specification, and the layer everything else hangs off. It is deliberately not the whole thing. It does not hold who your users are, what a feature must deliver to be accepted, what the screens look like, what the data model is, or whether the product is actually finished.

**Lyriks Community** is the free, self-hosted appliance that holds all of that, with Unspaghettit inside it. It embeds this exact dashboard, this exact engine and these exact JSON models, and wraps the rest of the product specification around them.

Free for one user and one project, on your own machine. Nothing is taken away from Unspaghettit by installing it: the standalone tool stays exactly what it is, under the same AGPL licence.

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

Everything is one workspace: one login, one MCP endpoint for every AI client, PostgreSQL for the workspace, live sync between people and agents, and backups.

## How it relates to what you already have

- **Same engine.** The appliance installs the published `unspaghettit` package and runs the same dashboard binary. Your models are the same plain JSON snapshots, in the same format.
- **Same MCP vocabulary.** The behavior tools you already prompt with keep working; the appliance adds the workspace tools next to them.
- **Your projects move in four steps, no converter.** Export each project to a JSON file, install the appliance, connect your agent over MCP, then let your LLM recreate the project and compare the counts. A few minutes per project: [Move your projects in 4 steps](https://lyriks.io/blog/from-unspaghettit-to-lyriks-community-edition#moving-a-project-in-four-steps).
- **Still local.** The appliance runs on your machine or your own server. Nothing is sent anywhere by default.
- **Still yours.** Standalone Unspaghettit remains free and open source under AGPL-3.0, and this page is not a deprecation notice for it.

## Install

Get a free key at [lyriks.io/get-started](https://lyriks.io/get-started). It arrives by email, bound to that address.

```bash
# Linux / macOS
curl -fsSL https://get.lyriks.io | sh
```

```powershell
# Windows, in a NORMAL PowerShell window (not an administrator one)
irm https://get.lyriks.io/windows | iex
```

The command checks the machine, offers to install what is missing (Docker, and WSL2 on Windows), fetches the appliance into `~/lyriks`, installs it, and runs a smoke test before declaring success. No account and no email are asked at install time. The licence key is asked once and is optional: press Enter to skip it, and give it when you claim the installation.

Then open `http://localhost:3000` and claim the installation with the email that received the key, the key itself, and a password you choose. Full walkthrough, variants and troubleshooting: [the install guide](https://lyriks.io/docs).

## Editions

Community is free for one user and one project. The paid plans add the rest: **Solo Builder** opens more projects and change simulation, **Team** adds members, **Enterprise** adds the solver that proves rules for every value. A paid key is entered in the app, on its activation page, and switches the installation in place. Plans and prices: [lyriks.io/pricing](https://lyriks.io/pricing).

**Tested Unspaghettit? Thank you.** Every beta tester gets 2 months of Lyriks Enterprise, on us: [claim my 2 months](https://lyriks.io/blog/from-unspaghettit-to-lyriks-community-edition#beta-offer).

## Turning the offer off

The dashboard shows the Lyriks Community splash on every visit, and only when it is running standalone. Closing the panel hides it for that visit; the button that says "keep using Unspaghettit on its own" retires it for good, and it is the only thing that does. Either way, the app menu (the gear, top right) reopens it.

It never appears when a host product owns the deployment, which is decided by three signals:

- `PUBLIC_UNSPA_HOST_PRODUCT` is set to a non-empty value. Set it to the name of your product when you embed this dashboard in something of your own, and the offer stays hidden for that deployment, whatever URL users reach it by.
- the navigation carries `?brand=<host>`, the host livery marker.
- the document is framed by a host with `?embed=1`.

