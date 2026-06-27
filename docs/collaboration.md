# Collaboration

Multiple humans and AI agents can edit the same runtime live. It is built on a Yjs WebSocket server, so changes flow between tabs, agents, and MCP writes without reloads.

## Real-time sync

Every dashboard tab subscribes to a per-room Yjs WebSocket. Out-of-band changes (MCP writes, other tabs) flow in without a reload. Each change raises an activity toast carrying a breadcrumb path (`Project › Feature › Surface › Action`) and a "View" button.

## Identity

Click the round avatar in the header to set your display name. Every history entry you create is tagged with it. The name is stored in browser localStorage and never sent off-machine. Your first visit prompts once. The avatar dropdown is the explicit way to change or reset it later.

## Attribution

MCP-driven changes carry an `AI · for John` label: the AI badge stays primary, the human name is the supporting attribution. It is resolved server-side from whoever is currently at the dashboard, so spec changes made by an agent are always distinguishable from direct human edits.

## Project history

A read-only timeline tab on the project page lists every change (rename, feature add or remove, queue mutation, and so on) with author and timestamp. The shared per-project Y.Doc room feeds it, so MCP edits and human edits land in the same audit log.

## Implementation queue

A drag-and-drop "implement next" list per project. The LLM uses `mcp__unspa__get_next_queued`, so you can say "implement the next thing" without naming it. Items auto-prune as `.unspa.json` flips them to implemented.

## Backup and share

The project page's **Export .unspa** button produces an encrypted bundle (project, features, and status sidecars in a single file). The matching **Import .unspa** on the projects index restores it. A passphrase is required on both ends, and the file itself reveals nothing about its contents. See [Security](security.md) for the crypto details.
