# AppySentinel Pattern Catalogue & Capability Matrix

Living audit trail of:

1. Architectural patterns we encounter while building applications on AppySentinel
2. Which applications use which patterns
3. The gap between where AppySentinel is today and what real applications need

This is the canonical answer to: *"What have we proven works? What's only on paper? Where is AppySentinel still bespoke per-app?"*

Updated as we go. New patterns get added when we discover them; matrix cells get updated when an app is built or a recipe lands.

**Reference convention**: Code references in this document use GitHub repo paths — `github.com/appydave/<repo>/blob/main/<path>` — not absolute filesystem paths. This keeps references stable across machines and deployments. Relative paths within a single repo are acceptable.

---

## Apps tracked

| App | Role | Path | Status |
|-----|------|------|--------|
| AppyRadar (legacy) | Reference / pre-split | `~/dev/ad/apps/appyradar/` | Existing — Sentinel + Viewer conflated in one repo. `audit.ts` is the data half; `hotel-live.html` / Mochaccino panels / Baku app are the viewer half. |
| AppyRadar Sentinel | Pilot 1 (active) | `github.com/appydave/appyradar-sentinal` | Built on AppySentinel. SSH-central orchestration across 5 machines. Stress-test for C2 + I2 + E3. Graduation tracking: `docs/graduation-candidates.md` in that repo. |
| AppyRadar Viewer | Out of scope (here) | TBD — split from legacy | Separate project; consumes the Sentinel via the Access zone (API / MCP). |
| SS Data Query Sentinel | Pilot 2 (planned) | TBD under `~/dev/clients/supportsignal/` | To be built on AppySentinel. Source for stressing the SQL-diff + MCP-binding pattern. |
| AngelEye (legacy) | Reference / deferred pilot | `~/dev/ad/apps/angeleye/` | Existing — Sentinel + Viewer conflated. Future stress-test for multi-Sentinel push patterns; deferred as a third pilot for now. |

---

## Status legend

**Sentinel support:**

- ✅ **baked** — implemented in `packages/core/src/`
- 🛠️ **recipe** — recipe spec planned or written; generated per project by the install agent
- 🔮 **future** — theoretical, unvalidated, deferred to v2+
- ❓ **open** — design decision still open
- ⛔ **out of scope** — not AppySentinel's concern

**Per-app cells:**

- ✓ uses this pattern today (validated by being built)
- 🚧 planned to use
- — does not / will not use
- ? to investigate

---

## Patterns

### Foundation / lifecycle

| # | Pattern | Sentinel support | Notes |
|---|---|---|---|
| F1 | Always-on loop | ✅ baked | `createSentinel()` + `Lifecycle` (start/stop/reload, SIGINT/SIGTERM/SIGHUP) |
| F2 | Headless / no UI | ✅ baked (architectural rule) | Spec §1. Visualisation is a separate Viewer app reached through the Access zone. |
| F3 | Sentinel/Viewer split | ❓ open | Architectural rule; not enforced by code. Should be guidance the install agent reinforces. |
| F4 | Signal envelope (OTel-aligned) | ✅ baked | `signal.ts` — id, ts, schema_version, source, machine, sentinel_id, kind, name, severity, attributes, payload |
| F5 | Internal pub/sub (SignalBus) | ✅ baked | `bus.ts` — emit / emitAndWait / on, isolated error handling |
| F6 | Hierarchical config + reload | ✅ baked | `config.ts` — defaults → file → env, Zod-validated, SIGHUP reload, onChange |
| F7 | Capability registry | ❓ open | Core primitive. Recipes register their name, zone, description, and operations on wire-up. Zero new deps. The registry is the single source of truth that all three Access bindings read to serve their help surface: `mcp-binding` → `sentinel_help` tool; `api-binding` → `GET /help` (full) + capabilities summary in `GET /health`; `cli-binding` → `--help` flag. `toHelpDoc()` returns markdown; `toJSON()` returns structured JSON shaped to mirror MCP's `list_tools` schema so AI agents can build skills from it without reading source. Blocked on: design + core session. Not blocking any current pilot. See interface sketch in gap #11. |

### Collect (zone 1 — §7.1)

| # | Pattern | Sentinel support | Notes |
|---|---|---|---|
| C1 | Pulse-driven local poll | 🛠️ recipe | `poll-command`, `poll-http` |
| C2 | Pulse-driven SSH multi-host orchestration | 🛠️ recipe | `orchestrator-ssh`. PoC validated 2026-04-27 (`appyradar-sentinal-safe/`). Design decisions locked: **compound scripts** (7 SSH/machine, down from 12) over ControlMaster (revisit only if intervals drop below 5min or harness lands). Machine collection is currently sequential; `Promise.all` is the harness upgrade path. Machine config: `{ name, host }`. Signal shapes: `machine.snapshot` (state) + `machine.offline` (event). Collection intervals are a ConfigLoader concern, not hardcoded. Full spec: `appyradar-sentinal-safe/docs/orchestrator-ssh-recipe.md`. |
| C3 | Pulse-driven SQL diff (DB mirror) | 🛠️ recipe | New, needed for SS pilot. Reads remote DB by `updated_at`, writes JSONL of changed records locally. Sibling of `poll-http` / `poll-command`; not yet in spec §7.1. |
| C4 | Event-driven file watch | 🛠️ recipe | `watch-directory` (chokidar) — priority recipe per spec §12 |
| C5 | Event-driven webhook receiver | 🛠️ recipe | `hook-receiver` — AngelEye pattern |
| C6 | Event-driven log tail | 🛠️ recipe | `watch-logfile` |
| C7 | Subprocess wrap | 🛠️ recipe | `subprocess-wrap` — long-running supervised subprocess |
| C8 | Active MCP client | 🔮 future | Sentinel-as-MCP-client reading from another MCP server. The mirror of `mcp-binding`. One concrete use case: when a capability graduates from inline plugin to standalone sentinel (see Capability Graduation section), the host sentinel replaces its SSH-scraping collector with a C8 client that speaks to the graduated sentinel's Access zone. Defer until first graduation event. |
| C10 | Ingest gesture | 🛠️ recipe | A Collect sub-category for capabilities that pull from external data sources (wearables, file feeds, external services) rather than reading machine state directly. Ingest gestures graduate faster than point-metric collectors because they represent full domains (transcripts, events, files). Example: OMI wearable transcript ingestion in AppyRadar Sentinel (`github.com/appydave/appyradar-sentinal/blob/main/src/collectors/parsers.ts`). Graduation trigger: when the domain has its own enrichment pipeline or storage needs beyond what the host sentinel should own. |
| C9 | Snapshot capture | 🛠️ recipe | `snapshot-capture` — combine signals into structured snapshot. AppyRadar pattern. |

### Access (zone 2 — §7.3)

Per Anthropic's API/CLI/MCP framework. Mature Sentinels ship all three bindings. Each binding is a thin adapter that routes to `query/` or `command/` in `src/access/`.

| # | Pattern | Sentinel support | Notes |
|---|---|---|---|
| A1 | API binding (HTTP) | 🛠️ recipe | `api-binding` (Hono). Foundation per Anthropic ladder. Thin adapter; routes to `query/` or `command/`. |
| A2 | CLI binding | 🛠️ recipe | `cli-binding`. Local-first developer composition (pipe to jq / grep, on-machine agent loops). Thin adapter; routes to `query/`. |
| A3 | MCP binding | 🛠️ recipe | `mcp-binding`. PoC validated 2026-04-27 (as `mcp-expose`). Design confirmed: **read-only layer over snapshot-store** — MCP server reads the snapshot file, does not touch collectors or live systems. Layering: `collector → sentinel-latest.json → MCP binding → agents`. Data-age field is first-class on every response (agents need to know how fresh data is). Tool granularity: summary tool + detail tool + domain-specific aggregated tools. One command-like tool (`trigger_collect`) is acceptable — spawns a subprocess, does not mutate machine data; observer-only invariant holds. Full spec: `appyradar-sentinal-safe/docs/mcp-surface.md`. |
| A4 | Query layer | 🛠️ recipe | `query-layer` — `src/access/query/` convention, returns `QueryResult<T>`. Pure functions over snapshot data. No transport knowledge. Called by bindings. |
| A5 | Command layer | 🛠️ recipe | `command-layer` — `src/access/command/` convention, sentinel-only writes. Commands control the Sentinel itself — never the systems it observes. Examples: trigger an immediate collection; add a host to fleet config; adjust a polling schedule. Command functions are stateless — effects reach the collection loop via files in `state/` (commands write, loop reads). No shared memory between command layer and loop. See spec §7.3 for `state/` directory convention and `investigateMachine` pattern. |

### Deliver (zone 3 — §7.4)

| # | Pattern | Sentinel support | Notes |
|---|---|---|---|
| D1 | HTTP push (batched, retry, backoff) | 🛠️ recipe | `http-push` |
| D2 | File-relay | 🛠️ recipe | `file-relay` — rsync / Syncthing / network mount |
| D3 | Supabase push | 🛠️ recipe | `supabase-push` |
| D4 | OTLP push | 🛠️ recipe | `otlp-push` — translate Signal → OTLP |
| D5 | Socket.io emit (deliver role) | 🛠️ recipe | Push to a remote Socket.io server. Deliver role only — Socket.io as an Access binding removed (Viewer concern). |
| D6 | Multi-Sentinel push-to-central | 🔮 future | "5 Sentinels each on a host pushing to a central aggregator." NOT validated by either pilot. AppyRadar dodges via SSH-from-one. Defer until a real use case demands per-host collection. |

### Internal (storage + enrichment — §7.2 / §7.5)

| # | Pattern | Sentinel support | Notes |
|---|---|---|---|
| I1 | File-based store (JSONL append) | 🛠️ recipe | `jsonl-store`. Default. Append-only + index JSON. AngelEye / FliHub pattern. |
| I2 | File-based store (snapshot JSON) | 🛠️ recipe | `snapshot-store`. PoC confirmed 2026-04-27 as a distinct recipe from `jsonl-store` — different purpose (current state, not history), different read pattern (single JSON.parse, no index), different write pattern (full overwrite, not append). Convention: `snapshots/sentinel-latest.json` (always-current) + dated archive. Spec §7.2 needs updating to name this distinctly. |
| I3 | Memory ring buffer | 🛠️ recipe | `memory-buffer`. Ephemeral, configurable size. |
| I4 | SQL store | 🛠️ recipe (non-default) | `sqlite-store`. Reserved for cases that genuinely earn it. File-based is default per fragility argument (schema migrations, multi-machine pain, debug cost). |
| I5 | Atomic file write | ✅ baked | `atomic-write.ts` — temp + rename + optional fsync |
| I6 | Serial async queue | ✅ baked | `serial-queue.ts` |
| I7 | Structured logger (Pino) | ✅ baked | `logger.ts` |
| I8 | Deterministic classifier (Tier 1 enrichment) | 🛠️ recipe | AngelEye Tier 1 — rules-based |
| I9 | Heuristic classifier (Tier 2 enrichment) | 🛠️ recipe | AngelEye Tier 2 — regex / patterns |
| I10 | LLM classifier (Tier 3 enrichment) | 🛠️ recipe | AngelEye Tier 3 — semantic. Lower priority. |
| I11 | Event normaliser | 🛠️ recipe | `event-normaliser` — canonical Signal envelope + payload reference. Priority recipe per spec §12. |

### Operational (runtime — §7.6)

| # | Pattern | Sentinel support | Notes |
|---|---|---|---|
| O1 | Run as launchd service | 🛠️ recipe | `register-as-launchd` (macOS) |
| O2 | Run as systemd service | 🛠️ recipe | `register-as-systemd` (Linux) |
| O3 | Run as PM2 process | 🛠️ recipe | `register-as-pm2` |
| O4 | Run in Docker container | 🛠️ recipe | `register-as-docker` |

### Cross-cutting (coordination + security — §7.7 / TBD §7.8)

| # | Pattern | Sentinel support | Notes |
|---|---|---|---|
| X1 | Config-pull from central endpoint | 🛠️ recipe | `config-pull` — periodic pull, hot-reload |
| X2 | Machine-role branching | 🛠️ recipe | `machine-role` — recorder / editor / orchestrator capability switch |
| X3 | Sentinel-mesh discovery | 🔮 future | `sentinel-mesh` — Sentinels discover and read from each other |
| X4 | Security: localhost-bind only (Tier 0) | ❓ open | Default for solo machines. No auth needed. |
| X5 | Security: bearer token (Tier 1) | 🛠️ recipe | Multi-machine reach over Tailscale / LAN. Belt-and-braces with Tailscale ACLs. Validated by SS Sentinel pilot: bearer token in `Authorization: Bearer <token>` header, token stored in `.env`, read at HTTP binding startup. Works for Claude Code MCP connections; does NOT work for claude.ai CoWork connectors (those require OAuth — see X6). |
| X6 | Security: public OAuth (Tier 2) | 🛠️ recipe | Required when exposing a Sentinel to claude.ai CoWork. Validated by SS Sentinel pilot: a **self-contained OAuth server** (no external provider) embedded in the HTTP binding — three endpoints: `/.well-known/oauth-authorization-server` (discovery, required by claude.ai), `/authorize` (shows approval page, redirects with code), `/token` (exchanges code for access token). Client ID + secret are configured in `.env` and shared with each CoWork user. **Known gap**: in-memory token store is lost on process restart — deployed Sentinels (launchd/systemd) must persist tokens to a file or use long-lived JWTs, otherwise users must re-authenticate after every restart. See `docs/tunneling-guide.md` for Tailscale Funnel setup (required for a public HTTPS URL). |
| X7 | Tailscale ACLs | ⛔ out of scope | Provided by Tailscale itself; AppySentinel relies on it implicitly when host is on a tailnet. Captured for awareness only. |

---

## Capability Graduation

Architectural doctrine for how capabilities move through the AppySentinel ecosystem. Direction of travel is always forward — capabilities do not regress.

### The three-stage lifecycle

| Stage | Name | What it means | How the host sentinel talks to it |
|-------|------|---------------|----------------------------------|
| **1** | Inline collector | Capability lives inside the host sentinel as a direct SSH / file / API collector | Direct function call within `collectMachine()` or equivalent |
| **2** | Standalone sentinel | Capability has its own always-on process, its own lifecycle, and its own Access zone | Via the graduated sentinel's Access zone — MCP (C8), REST (A1), or CLI (A2), whichever the host needs |
| **3** | Recipe | Pattern proven across two or more independent pilots; extracted into AppySentinel for scaffolding | Generated into future sentinels by `configure-sentinel`; no longer a runtime relationship |

### Promotion triggers

- **Stage 1 → 2**: The capability has its own data lifecycle, its own storage needs, its own consumers beyond the host sentinel, or its own enrichment pipeline. One is enough.
- **Stage 2 → 3**: The same sentinel pattern appears in two or more independent pilots without bespoke variation. That's the signal to extract it as a recipe.

### Inter-sentinel communication (Stage 2+)

When a capability graduates to a standalone sentinel, the host sentinel speaks to it via its Access zone. The binding is not prescribed — it depends on what the host needs:

- **MCP** — for agent / Claude integration (pattern C8)
- **REST API** — for programmatic consumption (pattern A1)
- **CLI** — for local scripting and composability (pattern A2)

**Key invariant**: once a capability has its own Access zone, the host sentinel never SSH-scrapes its internals. The Access zone is the contract.

### Ingest gestures and graduation pressure

Ingest gestures (C10) — capabilities that pull from external data sources rather than machine telemetry — tend to graduate faster. They represent full domains (transcripts, events, files) with their own enrichment and storage concerns. When an ingest gesture starts accumulating its own pipeline logic, that's the graduation trigger.

### Per-app graduation tracking

Each sentinel that contains inline collectors should maintain a `docs/graduation-candidates.md` tracking the current stage of each capability, what would trigger promotion, and any blockers. AppyRadar Sentinel example: `github.com/appydave/appyradar-sentinal/blob/main/docs/graduation-candidates.md`.

---

## Capability matrix

Pattern × app. `✓` = uses today; `🚧` = planned; `—` = does not / will not; `?` = to investigate.

| Pattern | AR (legacy) | AR Sentinel (pilot 1) 🟢 | SS Sentinel (pilot 2) | AngelEye (legacy) |
|---|:---:|:---:|:---:|:---:|
| **F7** Capability registry | — | — | — | — |
| **F1** Always-on loop | — (one-shot) | ✓ | 🚧 | ✓ |
| **F2** Headless / no UI | — (conflated) | ✓ | 🚧 | — (conflated) |
| **F3** Sentinel/Viewer split | — | ✓ | 🚧 | — |
| **F4** Signal envelope | — | ✓ | 🚧 | — (custom shape) |
| **F5** SignalBus | — | ✓ | 🚧 | — |
| **F6** Config + reload | — | ✓ | 🚧 | ? |
| **C2** SSH multi-host poll | ✓ | ✓ | — | — |
| **C3** SQL diff mirror | — | — | 🚧 | — |
| **C4** File watch | — | — | ? | ? |
| **C5** Webhook receiver | — | — | — | ✓ |
| **C8** Active MCP client | — | — | — | — |
| **C9** Snapshot capture | ✓ | ✓ | 🚧 | — |
| **C10** Ingest gesture | — | ✓ (OMI) | — | — |
| **A1** API binding | — | 🚧 | 🚧 | ✓ (legacy) |
| **A2** CLI binding | — | ? | ? | — |
| **A3** MCP binding | — | ✓ | 🚧 | ? |
| **D1** HTTP push | — | — | — | — |
| **D3** Supabase push | — | ? | — | — |
| **D6** Multi-Sentinel push-to-central | — | — | — | — |
| **I1** JSONL store | — | ? | 🚧 | ✓ |
| **I2** Snapshot JSON store | ✓ | ✓ | — | — |
| **I3** Memory ring buffer | — | — | — | ? |
| **I4** SQL store | — | — | ? | ? |
| **I5** Atomic write | — | ✓ | 🚧 | ✓ |
| **I8** Deterministic classifier | — | — | — | ✓ |
| **I9** Heuristic classifier | — | — | — | ✓ |
| **I11** Event normaliser | — | 🚧 | 🚧 | ? |
| **O1** launchd | — | 🚧 (next) | ? | ? |
| **X1** Config-pull | — | ? | — | — |
| **X4** Localhost-bind security | — | 🚧 | 🚧 | ? |
| **X5** Bearer-token security | — | ? | ✓ | — |
| **X6** Public OAuth (CoWork) | — | — | ✓ | — |

---

## Gap summary (where AppySentinel needs to grow)

Synthesised from pattern × app — patterns the pilots need that AppySentinel doesn't yet provide as a recipe:

1. **`orchestrator-ssh` recipe** — Design locked by PoC (2026-04-27). Compound scripts, 7 SSH/machine, signal shapes defined. Ready to formalise into AppySentinel recipe. Full spec at `appyradar-sentinal-safe/docs/orchestrator-ssh-recipe.md`.
2. **`sql-diff-collector` recipe** — SS pilot blocks on this. **New pattern not yet in spec §7.1.** Sibling of `poll-http` / `poll-command`. Needed to formalise.
3. **`snapshot-store` recipe** — PoC confirmed as distinct from `jsonl-store` (2026-04-27). Spec §7.2 needs updating. Convention: `snapshots/sentinel-latest.json`.
4. **`mcp-binding` recipe** — Pattern locked by PoC (2026-04-27). Read-only over snapshot-store. Data-age field first-class. Full spec at `appyradar-sentinal-safe/docs/mcp-surface.md`.
5. **`api-binding` recipe** — AppyRadar Sentinel needs this so the AppyRadar Viewer (Baku app, hotel-live.html, Mochaccino panels) can consume snapshots.
6. **Sentinel/Viewer split guidance (F3)** — Not a recipe but an install-agent rule. Both legacy apps violate it; both pilots must enforce it. Capture as a §1 architectural commitment + install-agent prompt.
7. **Security tier model (X4–X6)** — X5 and X6 are now pilot-validated by SS Sentinel (2026-04-29). X5 (bearer token) confirmed for Claude Code; X6 (self-contained OAuth) confirmed for claude.ai CoWork. X4 (localhost-only) still ❓ — no pilot has shipped in pure solo-machine mode yet. Remaining work: extract X5/X6 as named recipes; add OAuth token persistence (file-backed or JWT) to the X6 recipe before it can be used with launchd/systemd deployments. See `docs/tunneling-guide.md`.

8. **Multi-machine fleet deployment** — No tooling for installing, configuring, or upgrading Sentinels across a fleet. The intended architecture is one Sentinel per machine, each self-reporting local state. AppyRadar's SSH-orchestration is a workaround for this gap, not the target design. Long-term fix: fleet install tooling (Ansible, or a future `configure-sentinel` fleet command). See spec §1 and §11.
   - **Topology is a deferred per-deployment choice, not a one-time framework decision** (resolved 2026-06-13, AppyRadar interview). Shape B (`orchestrator-ssh`, one box reaching into N) and Shape A (per-machine self-observation, relaying via D6) are both first-class; pick per deployment and migrate only when a concrete trigger appears. **Don't build per-machine install / D6 speculatively** — the SSH-from-one workaround is correct until one of these bites: **(a) offline blindness** — a node that's down yields no current data; a local sentinel keeps observing and retains local history to relay on reconnect; **(b) permission/security friction** — reaching *into* a remote host hits escalated-permission walls and is itself a risk surface, whereas self-observation + "push for data, pull for config" needs no inbound connection; **(c) agent-locality** — an agent on a host wants only *that* host's state, with no central round-trip. These triggers are the build-signal for gap #8 and D6 alike. (Motivating pilot: AppyRadar; the triggers are framework-general.)

9. **MCP registration at user scope** — The `claude mcp add` command defaults to project scope, meaning the MCP server only appears when Claude Code is opened inside that specific project folder. Sentinels are fleet/machine tools, not project tools — they should be registered at user scope so they are available in any Claude Code session regardless of working directory. The scaffold documentation and any generated README instructions must specify `--scope user` explicitly. See Scaffold Recommendations §S1 below.

10. **install-service scripts missing from scaffold** — `install-service.sh`, `uninstall-service.sh`, and the launchd plist template currently exist only in `appyradar-sentinal`. Every Sentinel needs them. They should be a scaffold output from `create-appysentinel` so new projects get them automatically. See Scaffold Recommendations §S2 below.

11. **`CapabilityRegistry` core primitive + help surface (F7)** — Every Sentinel should self-describe its wiring so developers and AI agents can discover capabilities without reading source code. Core gets a zero-dep `CapabilityRegistry`; recipes register on wire-up; each binding recipe exposes the registry in its format. Interface sketch:

```typescript
// packages/core/src/capability-registry.ts

type CapabilityZone = 'collect' | 'access' | 'deliver' | 'internal';
type OperationKind = 'query' | 'command' | 'tool' | 'event';

interface OperationSchema {
  name: string;
  kind: OperationKind;
  description: string;
  params?: Record<string, { type: string; description: string; required?: boolean }>;
  returns?: { type: string; description: string };
  example?: string;
}

interface RecipeCapability {
  name: string;         // e.g. 'owna-poller'
  zone: CapabilityZone;
  description: string;
  version?: string;
  operations?: OperationSchema[];
}

interface CapabilityRegistry {
  register(capability: RecipeCapability): void;
  list(): RecipeCapability[];
  get(name: string): RecipeCapability | undefined;
  toHelpDoc(): string;   // markdown — for cli-binding --help
  toJSON(): object;      // structured — for api-binding GET /help and mcp-binding sentinel_help tool
}
```

Usage pattern in a recipe:
```typescript
function ownaPoller(sentinel: Sentinel, opts: OwnaPollerOptions) {
  sentinel.capabilities.register({
    name: 'owna-poller',
    zone: 'collect',
    description: 'Polls OWNA API on a configurable interval and emits child/staff/attendance signals',
    operations: [
      { name: 'trigger-sync', kind: 'command', description: 'Trigger an immediate OWNA poll outside the normal schedule' },
      { name: 'last-sync', kind: 'query', description: 'Returns timestamp and stats of the most recent OWNA poll' }
    ]
  });
  // ... rest of recipe wiring
}
```

`/health` returns `{ status, uptime, capabilities: 3 }` (count only). `GET /help` returns full registry JSON. `sentinel_help` MCP tool returns the same JSON. Not blocking any current pilot — tackle alongside health-probe / dataDir / PID file in the dedicated core session.

12. **Data-as-first-class: a durable, schema'd data-provider model** — Today AppySentinel treats stored data as a byproduct of collection: payload schemas are documented per-recipe, not centrally enforced (see spec §7.2 / CONTEXT scope limit "no schema registry"), and there is no durability/backup story beyond `atomicWrite` + file storage. The forward direction (motivated by AppyRadar, framework-general) is to make **data itself a first-class, plugged-in concept**: a provider model where any fleet-meaningful shape is *owned* by the Sentinel under a declared schema, with backup/durability guarantees, **regardless of how it arrives** — *configured* (authored, rarely changing), *cron-scanned* (periodic collection), or *event-updated* (live). This unifies the schema-registry gap with a durability layer, and lets agents query authored/curated shapes (machine config, team/role composition) the same way they query scraped telemetry — replacing hand-maintained `.md`/memory facts with a live, durable, schema-checked source of truth. Sub-parts: (i) a schema registry (resolves the payload-versioning open item, spec §15); (ii) durability/backup for stored data (snapshot history, restore); (iii) a `data-provider` recipe family spanning the three ingestion modes. No current pilot blocks on this — it's the framework's data-plane roadmap, not a v1 requirement. The smallest first step that would prove it: a single configured (authored) schema served through the Access zone alongside the scraped snapshot.

What's deferred (no current pilot validates):

- **D6** Multi-Sentinel push-to-central — revisit when AngelEye becomes a pilot or AppyRadar genuinely needs per-host collection.
- **C8 / X3** Active MCP client / Sentinel-mesh — symmetric, no use case yet.
- **I4** SQL storage — kept available, file-based is default; SQL has to earn it case by case.

---

## Scaffold Recommendations

Things `create-appysentinel` should emit by default, currently missing from the scaffold template.

### S1 — MCP registration at user scope

**Problem.** When a developer follows generated README instructions and runs `claude mcp add <sentinel-name> -- bun /path/to/mcp.ts`, Claude Code registers the server at project scope by default. The MCP tools only appear when Claude Code is opened inside that project folder. Sentinels are not project tools — they run on a machine, observe a machine, and should be queryable from any Claude Code session on that machine.

**Correct command.**

```bash
claude mcp add --scope user <sentinel-name> -- bun /absolute/path/to/src/access/bindings/mcp.ts
```

Note: the path must be absolute. Relative paths break when Claude Code is opened from a different working directory.

**What needs to change in the scaffold.**

- The generated `README.md` (or `docs/getting-started.md`) must show `--scope user` in the registration command, not the bare `claude mcp add` form.
- The `configure-sentinel` skill (Layer 2 agent) must emit `--scope user` when it prints or runs the registration step.
- Any `scripts/register-mcp.sh` helper (if generated) must include `--scope user`.

**Validation.** After registration, running `claude mcp list` from a directory outside the project should show the sentinel's tools. If it doesn't, the server is registered at project scope, not user scope.

---

### S2 — install-service scripts in scaffold template

**Problem.** `install-service.sh`, `uninstall-service.sh`, and the launchd plist template currently live only in `github.com/appydave/appyradar-sentinal`. Every Sentinel that reaches Deployed mode (spec §9.3) needs them. Without them, the developer has to hand-author a plist and load it manually — error-prone and not documented.

**Pattern (from appyradar-sentinal).** The scripts use three placeholder tokens substituted at install time:

| Token | Value |
|-------|-------|
| `{{PROJECT_DIR}}` | Absolute path to the project root |
| `{{BUN_PATH}}` | Output of `which bun` |
| `{{HOME_DIR}}` | `$HOME` |

`install-service.sh` reads these from the environment or derives them, writes `~/Library/LaunchAgents/com.appydave.<project-name>.plist` (macOS) or the equivalent systemd unit path (Linux), and loads the service. `uninstall-service.sh` unloads and removes the file.

**What needs to change in the scaffold.**

- `create-appysentinel` should emit `scripts/install-service.sh`, `scripts/uninstall-service.sh`, and `scripts/launchd.plist.template` (macOS) / `scripts/systemd.service.template` (Linux) as part of the base scaffold output — not as an opt-in recipe, because every Sentinel that graduates to Deployed mode needs them.
- The project name substitution (`com.appydave.<project-name>`) should use the sentinel name provided at scaffold time.
- The `register-as-launchd` recipe (§7.6 / O1) should reference these scaffold-emitted scripts rather than generating its own.

**Reference implementation.** `github.com/appydave/appyradar-sentinal/scripts/` — extract the pattern from here when updating the scaffold template.

---

### S3 — MCP tool pairing rule (list + get for every entity)

**Problem.** A `get_<entity>(id)` tool is a dead-end unless the caller already has a UUID. When only `get_company(uuid)` exists but `list_companies()` does not, an AI agent cannot enumerate entities — it can only fetch ones it already knows about. This makes the MCP surface useless for discovery tasks.

Validated by SS Sentinel pilot: `get_company` existed without `list_companies`, so claude.ai CoWork could not surface companies that had no incidents. The only companies visible were those that appeared in other tools' results.

**Rule.** Every MCP-exposed entity must ship a `list_<entity>()` tool alongside its `get_<entity>(id)` tool:

- `list_<entity>()` — returns a summary array (ID + key fields). Accepts optional filter params. Paginates if the entity set can be large.
- `get_<entity>(id)` — returns full detail for one record by ID.

Neither tool is optional. A `get_*` without a `list_*` is an incomplete surface.

**What needs to change in the scaffold.**

- The `mcp-binding` recipe template should include a commented example of both tools for a sample entity.
- The `configure-sentinel` agent prompt should ask "for each entity you're exposing, does it have both a list and a get tool?" as a checklist item before generating the binding.

---

## Change log

| Date | Change |
|------|--------|
| 2026-06-13 | Added gap #12 (data-as-first-class: durable, schema'd data-provider model) — unifies the no-schema-registry limit with a durability/backup layer + `data-provider` recipe family across configured/cron/event ingestion. Annotated gap #8 + D6 with the topology-as-deferred-choice resolution and the a/b/c migration triggers (offline blindness / permission friction / agent-locality). Source: AppyRadar interview; framework-general distillation. Companion edits in `design-synthesis.md` §6 Q1+Q3 (resolved) and `CONTEXT.md` §4/§7. |
| 2026-05-04 | Added F7 Capability registry pattern. Added gap #11 with full `CapabilityRegistry` interface sketch. F7 added to capability matrix (all —, not yet piloted). |
| 2026-04-29 | X5/X6 promoted from ❓ open to 🛠️ recipe — both validated by SS Sentinel pilot. X5 (bearer token) confirmed for Claude Code MCP. X6 (self-contained OAuth with `/.well-known/` discovery) confirmed for claude.ai CoWork. OAuth token persistence gap noted under X6. Capability matrix updated: X5 ✓ and X6 ✓ for SS Sentinel. Gap #7 updated. Added S3 (MCP list+get pairing rule). Added `docs/tunneling-guide.md`. |
| 2026-04-28 | Added Scaffold Recommendations section (S1: MCP user-scope registration; S2: install-service scripts in scaffold template). Gap items 9 and 10 added to gap summary referencing S1/S2. |
| 2026-04-28 | A5 Command layer: added file-based signal pattern (state/ directory, stateless commands, loop as single stateful actor). References spec §7.3 additions. |
| 2026-04-28 | Vocabulary sweep: all residual "expose surface" → "Access zone"; E1/E2 → A1/A2 in capability graduation section. A5 Command layer notes enriched with concrete examples. Gap #8 (multi-machine fleet deployment) added. Single-host framing corrected in spec §1 (one-per-machine is the intended design; AppyRadar SSH is a workaround). |
| 2026-04-28 | v0.2.0 vocabulary refactor: Expose → Access (zone 2). E1/E2/E3 renamed A1/A2/A3 (`api-binding`, `cli-binding`, `mcp-binding`). Added A4 query-layer, A5 command-layer. All boundary umbrella references updated to zones. |
| 2026-04-27 | Added Capability Graduation section (three-stage lifecycle, inter-sentinel communication, ingest gesture graduation pressure). Added C10 Ingest gesture pattern. Added GitHub path reference convention. Updated C8 note to reference graduation. Updated capability matrix: AR Sentinel pilot 1 promoted from 🚧 to ✓ on F1-F6, C2, C9, C10, E3, I2, I5. AppyRadar Sentinel now has real GitHub path. |
| 2026-04-27 | C2 / I2 / E3 updated with PoC-validated design decisions from `appyradar-sentinal-safe/`. Gap summary updated to reflect C2/I2/E3 now have locked designs. |
| 2026-04-26 | Initial catalogue. Seeded from spec §5–§7 + AppyRadar / AngelEye forensic notes + the Collect/Expose/Deliver reframe + the Anthropic API/CLI/MCP framing. |

---

*Append new patterns / apps / status changes above as the project evolves. Treat the gap summary as the current to-do for AppySentinel itself.*
