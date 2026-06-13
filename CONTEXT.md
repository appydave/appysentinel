---
generated: 2026-04-28
generator: system-context
status: snapshot
sources:
  - package.json
  - DEVELOPMENT.md
  - tsconfig.json
  - docs/appysentinel-spec.md
  - docs/pattern-catalogue.md
  - docs/documentation-guide.md
  - packages/core/package.json
  - packages/core/src/signal.ts
  - packages/core/src/bus.ts
  - packages/core/src/lifecycle.ts
  - packages/core/src/config.ts
  - packages/core/src/create-sentinel.ts
  - packages/core/src/atomic-write.ts
  - packages/core/src/serial-queue.ts
  - packages/core/src/logger.ts
  - packages/core/src/index.ts
  - packages/core/test/signal.test.ts
  - packages/core/test/bus.test.ts
  - packages/core/test/lifecycle.test.ts
  - packages/core/test/config.test.ts
  - packages/core/test/create-sentinel.test.ts
  - packages/core/test/atomic-write.test.ts
  - packages/core/test/serial-queue.test.ts
  - packages/core/test/logger.test.ts
  - packages/cli/src/scaffold.ts
  - packages/cli/src/prompts.ts
  - packages/cli/src/handoff.ts
  - packages/cli/test/scaffold.test.ts
  - packages/template/src/main.ts
  - .github/workflows/ci.yml
  - context.globs.json
regenerate: "Run /system-context in the repo root"
---

# AppySentinel — Context Snapshot

## 1. Real Purpose

**The pain**: Every AppyDave project that collects local machine data ends up reinventing the same plumbing — an event envelope, an internal pub/sub bus, graceful shutdown handling, crash-safe file writes. Each invents incompatible shapes, conflates data collection with the dashboard that displays it, and ships all UI in the same process as the observer. When the dashboard is down, collection stops. When the observer crashes, you lose the event that would have explained why.

**What AppySentinel is**: A boilerplate for building **per-machine, always-on local data coordinators** — headless long-running processes that collect data from local sources, normalise it into a common Signal envelope, expose it for query and control via the Access zone (REST / CLI / MCP), and push it outward to downstream systems. One scaffold, consistently wired, no dashboard weight baked in.

**Who it's for**: AppyDave and collaborators building observability tooling for a 5-machine Tailscale-connected fleet. Primary consumers are AI agents (Claude Code via MCP) and downstream AppyStack dashboards. The two v1 pilots are AppyRadar Sentinel (SSH-based fleet telemetry) and SS Data Query Sentinel (Supabase DB mirror for SupportSignal).

**The distinction that matters**: AppySentinel builds Sentinels (observers). AppyStack builds Viewers (dashboards). They are separate applications that communicate through the Sentinel's Access zone surfaces. Conflating them is the precise failure mode this project exists to prevent.

---

## 2. Core Abstractions

Six concepts everything is built on. In dependency order:

### Signal
The atomic unit of telemetry. A stable outer envelope (id, ts, schema_version, source, machine, sentinel_id, kind, name, severity, attributes) wrapping a collector-specific `payload`. The envelope is fixed; the payload is typed per-collector using TypeScript generics. `SignalKind` is `log | metric | event | state | span` — OTEL-inspired but not OTEL. Every emitted record is a Signal; nothing escapes the envelope.

### SignalBus
The internal pub/sub. Collectors call `bus.emit(signal)` or `sentinel.emit(input)`. Storage, transport, and Access zone layers call `bus.on(handler)`. No direct coupling between producers and consumers. `emit()` is fire-and-forget (handler errors routed to `onError`, never break the bus). `emitAndWait()` is available for back-pressure scenarios (e.g. critical flush before shutdown).

### Lifecycle
The process harness. Three phases (starting → running → stopping) with hook lists executed in registration order on start, reverse order on stop. SIGINT/SIGTERM call `stop()`; SIGHUP calls `reload()`. `health()` is a synchronous snapshot for `/health` endpoints. The lifecycle is independent — multiple Sentinels per process each own one (though OS signals fan out to all).

### ConfigLoader
Hierarchical merge: static defaults → JSON config file → env vars. Zod-validated on each load. Reloadable on SIGHUP or programmatic call. `onChange()` callbacks fire on reload. The config file being absent is not an error.

### Access Zone
The bidirectional interface layer, structured into three sub-layers: **Bindings** (thin protocol adapters — MCP, HTTP, CLI — that own no logic and route to query/ or command/), **Query** (read side — pure functions over snapshot data returning `QueryResult<T>` with freshness metadata), and **Command** (write side — stateless functions that control the Sentinel itself via file-based signals, never reaching through to observed systems). Design pattern: CQRS-lite. Both query and command functions communicate through the filesystem — query reads from `snapshots/`, command writes to `state/`. The collection loop is the only stateful actor.

### Sentinel (the assembled object)
`createSentinel({ name, machine })` wires Signal + Bus + Lifecycle + Logger into a single facade. This is what every scaffolded `main.ts` interacts with. The facade exposes `emit()`, `on()`, `start()`, `stop()`, `reload()`, plus escape hatches (`sentinel.bus`, `sentinel.lifecycle`, `sentinel.logger`) for advanced use. Nothing happens until `sentinel.start()` is called.

---

## 3. Key Workflows

### Scaffold a new Sentinel
```
npx create-appysentinel my-sentinel
```
Layer 1 (static CLI `packages/cli`): prompts for project name + machine name, copies `packages/template` verbatim, rewrites `{{PROJECT_NAME}}` / `{{MACHINE_NAME}}` placeholders, rewrites `workspace:*` dep references to published semver ranges, runs `bun install`, `git init` + initial commit. The template ships `CLAUDE.md`, service registration scripts (launchd + systemd), and `.env.example` out of the box.

Layer 2 (agentic handoff): spawns `claude -p "<interview prompt>"`. Claude reads `.claude/skills/configure-sentinel/SKILL.md` in the scaffolded project, interviews the developer on interface / collectors / storage / transport / runtime, generates recipe code, smoke-tests the result. **Claude Code is a hard runtime dependency at install time.** If it's absent, the CLI prints the manual recovery command and exits non-zero.

### Wire and run a configured Sentinel
After install, the scaffolded `src/main.ts` is replaced by the configure-sentinel agent with a fully wired version. The pattern:
```typescript
const sentinel = await createSentinel({ name: 'my-sentinel', machine: process.env.MACHINE_NAME });
// Wire recipes as plugins:
hookReceiver(sentinel, { port: 5501 });     // Collect recipe
jsonlStore(sentinel, { dataDir: '...' });   // Internal storage recipe
mcpBinding(sentinel, { ... });              // Access zone binding
await sentinel.start();
sentinel.emit({ source: 'lifecycle', kind: 'event', name: 'sentinel.started', payload: {} });
```
Recipes register their lifecycle hooks via `sentinel.lifecycle.onStart()` / `sentinel.lifecycle.onStop()`. They subscribe to the bus or emit onto it. The sentinel's start/stop orchestrates everything in hook order.

### Emit a Signal from a collector
Collectors never construct the full Signal envelope manually. They call `sentinel.emit(input)` where `input` is a `SignalInput` — just `{ source, kind, name, payload }` plus optional severity/attributes. `mintSignal()` fills in id (ULID), ts (ISO 8601 now), schema_version, machine, and sentinel_id from the Sentinel's ambient context.

### Atomic file write (storage recipes)
Any recipe that writes to a flat file uses `atomicWrite(path, content)`. This writes to a temp file in the same directory, optionally fsyncs, then renames into place. On POSIX/APFS this is atomic at the directory-entry level — readers never see a torn write. Combined with `SerialQueue` to serialise concurrent writes to the same path.

### Reload config on SIGHUP
The Lifecycle listens for SIGHUP and calls `lifecycle.reload()`, which fires all registered `onReload` hooks. A config recipe registers its reload hook to re-read the config file via `configLoader.reload()`, validates through Zod, and notifies `onChange` subscribers. No restart required.

---

## 4. Design Decisions + Whys

**Headless-only rule**: Sentinels never ship a UI. Visualisation is a separate AppyStack Viewer that reads from the Sentinel's Access zone. Rationale: Sentinels must boot first (to capture the startup of heavier apps), stay lightweight (always-on cost must be negligible), and survive dashboard outages. Coupling collection to display fails all three tests.

**Push for data, pull for config**: Sentinels push Signals outward and optionally pull config inward. No inbound connections required for data. This means a Sentinel on a machine behind NAT can still deliver telemetry without a server needing to reach in.

**Observer-only by default (an 80/20 posture, not a blanket ban)**: A Sentinel is ~80% passive observer — it reacts to events and scheduled scans and never operates the systems it watches. The ~20% exception lives specifically on the **Access (MCP/API/CLI)** channel, where a minority of CUD operations is legitimate but **scoped to managing the Sentinel itself** (its config, schedule, paused hosts, local data sync) — never the observed systems. Richer remediation (restart an app, free disk, run fleet commands) is deliberately delegated outward to agents or the separate Viewer/UX, not built into the Sentinel. Rationale: a compromised Sentinel must not become an attack vector against the systems it watches. (This supersedes the earlier "mutation is a future `mcp-tools` recipe" framing; the recipe is still the mechanism for the rare opt-in, but the posture is the 80/20 split. Resolved 2026-06-13 — see `docs/design-synthesis.md` §6 Q3.)

**Three boundary zones — Collect / Access / Deliver**: All recipes at the Sentinel boundary fall into one of these roles. The same technology plays different roles in different positions (HTTP server is `api-binding`; HTTP server receiving webhooks is `hook-receiver` under Collect). Role, not technology, picks the zone. This classification came from observing that projects lose clarity when they mix "what I read" with "what I publish".

**Access zone follows Anthropic's API/CLI/MCP framework**: The three Access bindings are `api-binding` (Hono HTTP), `cli-binding` (shell tool), and `mcp-binding` (MCP server). Socket.io is dropped from the Access set — real-time fan-out to UI subscribers is a Viewer concern. Mature Sentinels ship all three bindings; new ones start with the surface that matches their primary consumer (default: `mcp-binding` for AI-agent consumers).

**CQRS-lite and file-based command signals**: The Access zone is split into Query (read) and Command (write). Command functions are stateless — they do not hold references to running loop state. Effects that need to reach the collection loop are communicated via files in a `state/` directory (commands write; loop reads at the top of each tick). This makes command functions pure (read file → modify → write file → return), keeps the loop as the single stateful actor, and prevents the singleton anti-pattern where a shared in-memory object couples the command layer to the loop. The alternative — shared mutable state — was attempted during AppyRadar Sentinel development and immediately identified as a code smell that breaks testability and restartability.
  - *Alternative considered*: Shared `SentinelRuntime` singleton in memory.
  - *Why rejected*: Couples command functions to runtime state; breaks unit-testability; invisible state mutations across code paths.

**Recipes are markdown specs, not code templates**: Recipes describe what to build; implementations are generated per-project by the configure-sentinel agent. This matches AppyStack's March 2026 shift away from static code templates. The implication: a new Sentinel project contains only the primitives baked into `core` until the agent interview generates recipe code. Recipe code lives in the user's project, not in this monorepo.

**File-based storage is the default**: JSONL append or snapshot JSON, not SQLite. Rationale: simpler debug (cat, jq, git diff), no schema migrations, no multi-machine file-locking hazards, crash-tolerant via `atomicWrite`. SQLite is available as a non-default recipe for cases that earn it.

**Recipes own their own runtime deps**: Core ships only `pino`, `ulid`, `zod`. Transport libs (chokidar, hono, MCP SDK, etc.) are added to the user's project only when a recipe is selected. A Sentinel that doesn't watch files doesn't carry chokidar.

**Two-layer install (static CLI + agentic handoff)**: The static CLI is deterministic and zero-dependency on LLMs — it always succeeds at mechanical scaffolding. The agentic handoff is where intelligence lives. If Claude Code is absent the CLI degrades gracefully: prints the manual recovery command and exits. The separation keeps the install path predictable and auditable.

**`emitAndWait` added alongside `emit`**: The spec only mandated `emit`. `emitAndWait` was added during implementation for back-pressure scenarios where it matters that subscribers have finished before continuing (e.g. flushing a critical store before shutdown). Used sparingly.

**`installSignalHandlers` opt-out**: Default `true` in production. Tests set `false` to avoid registering OS signal handlers in the test process. Without this, parallel test runs interfere with each other.

---

## 5. Non-obvious Constraints

**Claude Code is a hard runtime dependency at install time.** `npx create-appysentinel` calls `claude -p "..."` as its Layer 2. If the `claude` binary is not on PATH, the CLI exits non-zero with a clear error. The install is not complete after Layer 1 alone — the scaffolded project is functional but unconfigured (no recipes wired).

**`workspace:*` references must be manually bumped in `packages/cli/src/scaffold.ts`.** When a new version of `@appydave/appysentinel-core` or `@appydave/appysentinel-config` is published, the `PUBLISHED_VERSIONS` map in `scaffold.ts` must be updated. The CLI rewrites `workspace:*` to concrete version ranges when copying the template. Forgetting this causes newly scaffolded projects to install the wrong core version.

**Recipes are not in this repo.** The monorepo ships only primitives. `packages/template/.claude/skills/configure-sentinel/SKILL.md` is a placeholder. Until it is fleshed out (deliberately deferred for v1), the Layer 2 handoff runs but the agent works from the base prompt in `handoff.ts`, not from a project-local skill file.

**Stop hooks run in reverse registration order.** If you register collector stop hooks before store stop hooks, the stores drain before collectors stop — which is what you want. If you register them in the wrong order, you may lose the last signals emitted during shutdown. The convention: register infrastructure (bus, store, transport) before collectors.

**`emit()` is fire-and-forget.** Handler errors are caught and routed to `onError`, they never propagate to the emitter. If a storage handler throws (e.g. disk full), the Signal is lost silently unless you configure an `onError` hook. Default `onError` writes to `console.error`. Production projects should wire this to the Pino logger.

**Config layering: env vars win over the config file.** The merge order is defaults → file → env. This means `LOG_LEVEL=debug bun src/main.ts` overrides whatever the config file says. The env mapping is declared explicitly via `options.env` in `createConfigLoader` — no magic, but it means undeclared env vars are ignored.

**The Sentinel's `sentinelId` is unstable by default.** `createSentinel` generates `<name>-<ulid>` if no `sentinelId` is provided. This changes on every restart, which breaks Signal correlation across restarts. Pass a stable `sentinelId` (e.g. from the config file or a fixed constant) when you need cross-restart Signal correlation.

**Pre-push hook blocks broken code.** Husky installs a pre-push hook that runs `bun run test && bun run typecheck` on every `git push`. If either fails, the push is blocked. This is intentional — do not bypass with `--no-verify`. Fix the failure instead.

**Command functions must not hold runtime references.** Commands that reach into the running collection loop via a shared object (singleton, module-level variable, closure over main.ts state) introduce coupling that breaks testability and restartability. The correct pattern: command writes to `state/paused.json` or `state/trigger.json`; the loop reads on the next tick. If you find yourself passing a "runtime handle" into a command function, stop — that's the singleton anti-pattern.

---

## 6. Expert Mental Model

**Novice model**: "AppySentinel is a telemetry library I import to emit events."

**Expert model**: "AppySentinel is a boilerplate that gives me a process harness. The primitives (Signal, Bus, Lifecycle, Config, AtomicWrite, SerialQueue, Logger) are plumbing I get for free. Everything interesting lives in recipes — pluggable units I wire at startup. The Sentinel itself has no opinions about what I collect, how I store it, or how I expose it. Those are separate decisions, each scoped to a recipe."

The cognitive shift is from "library call" to "plugin composition". Recipes are not imported utilities — they are startup-time registrations that attach hooks to the Lifecycle and handlers to the Bus. The Sentinel is the composition point, not the logic.

A second shift: **boundary roles, not technologies**. When building a recipe, the first question is not "should I use HTTP or Socket.io?" but "which zone does this belong to — am I feeding data into the Sentinel (Collect), letting others read from or control it (Access), or pushing data outward from it (Deliver)?" The zone determines the design constraints. The same technology (HTTP server) in a Collect role (webhook receiver) has opposite coupling direction to the same technology in an Access role (REST API binding).

A third shift: **the Sentinel is not the system, it's the observer of the system.** The expert keeps the Sentinel small, cheap, and always-on. They build the dashboard as a separate Viewer app that reads from the Sentinel's Access zone. They resist the pull to add UI, admin endpoints, or mutation logic into the Sentinel.

A fourth shift: **recipes are byproducts of pilots, not speculative features.** An expert never writes a recipe without a concrete pilot demanding it. The pattern catalogue tracks capability gaps; pilots fill those gaps. Writing recipes ahead of need is premature generalisation — the interface won't be right until a real use case pressures it.

A fifth shift: **the collection loop is the only stateful actor.** Query functions read from files. Command functions write to files. The loop reads those files on each tick. Once you internalise this, you stop reaching for shared state and start asking "what file does this signal live in?" — which keeps every function unit-testable in isolation.

---

## 7. Scope Limits

AppySentinel explicitly does NOT:

- **No UI, dashboards, or visualisation.** These are separate Viewer applications built on AppyStack. The Sentinel's `api-binding` / `cli-binding` / `mcp-binding` Access surfaces are what Viewers consume.
- **No mutation by default.** Sentinels read/observe; they do not write back to the systems they watch. (Future opt-in `mcp-tools` recipe deferred to v1.1+.)
- **No fleet-wide install or upgrade tooling.** The intended architecture is one Sentinel per machine, each self-reporting local state. No tooling yet exists for installing, configuring, or upgrading Sentinels across a fleet. This is a documented gap (pattern catalogue gap #8).
- **No distributed streaming / durable queues.** No Kafka, no NATS. Transports are best-effort with local buffering.
- **No schema registry.** Payload schemas are documented per-recipe, not centrally enforced. *(Future direction — pattern-catalogue gap #12: a durable, schema'd "data-as-first-class" provider model that would own authored/curated shapes alongside scraped telemetry, with backup and a schema registry. Roadmap, not current behaviour.)*
- **No full OpenTelemetry implementation.** OTEL is the reference model. An `otlp-push` transport recipe can translate Signals to OTLP wire format, but the Sentinel is not an OTEL SDK.
- **No upgrade mechanism in v1.** The `appysentinel-upgrade` command is deferred to v1.1. The four-tier static classification from AppyStack (auto/recipe/never/owned) is explicitly NOT adopted for AppySentinel.
- **No Socket.io in the Access zone.** Real-time push to subscribers is a Viewer concern. Socket.io is available as a Deliver recipe only (push to a remote Socket.io server).
- **No recipe code in this repo.** The monorepo ships primitives and the scaffolding CLI. Recipe implementations are generated into user projects by the configure-sentinel agent.

---

## 8. Failure Modes

**Missing Claude Code at install time**
`create-appysentinel` calls `claude -p "..."` for Layer 2. If `claude` is not on PATH, the scaffold completes but the project is unconfigured. Symptom: CLI exits with a `claude-not-found` status and prints a manual recovery command. Fix: install Claude Code, then `cd <project> && claude -p "Run the AppySentinel configuration interview..."`.

**Unconfigured project (template walking skeleton)**
After Layer 1, the scaffolded `src/main.ts` is the minimal template that emits one `sentinel.started` event and idles. No collectors, no storage, no Access zone. If Layer 2 never ran (or was skipped), the project "works" but does nothing useful. Symptom: `bun src/main.ts` starts, logs `sentinel.started`, then sits idle with no further output.

**`workspace:*` rewrite not updated after publishing core**
If `PUBLISHED_VERSIONS` in `packages/cli/src/scaffold.ts` is stale, newly scaffolded projects pull the wrong core version. Symptom: `bun install` in the scaffolded project resolves an old version of `@appydave/appysentinel-core`; type errors or missing exports at compile time.

**Stop hook registration order**
If a collector is registered (and its stop hook added) before its store, the store stops first. Any signals emitted during the collector's stop hook (e.g. "collector stopped" events) are dropped. Symptom: last few signals missing from storage after a graceful shutdown. Fix: register infrastructure (stores, transports) before collectors.

**Unstable sentinelId across restarts**
Default `sentinelId` is `<name>-<ulid>` — changes on every restart. If downstream systems correlate signals by `sentinel_id`, they see a new identity after each restart. Symptom: dashboards show duplicate "machines", analytics break across restarts. Fix: inject a stable `sentinelId` from config.

**Config file absent vs config file malformed**
`createConfigLoader` treats a missing file as "no file layer" (not an error). A file that exists but contains invalid JSON or fails Zod validation throws at `configLoader.load()` time, which propagates out of `createSentinel`'s setup (if wired there) and prevents startup. Symptom: `TypeError` or `ZodError` on boot. Fix: validate the config file against the schema independently before deploying.

**SignalBus subscriber error silently absorbed**
A subscriber that throws (e.g. storage handler with a disk error) has its error caught and routed to `onError`. The Signal is considered delivered; no retry. Symptom: storage stops receiving signals with no visible crash, only a `console.error` line. Fix: wire `onError` to the Pino logger and monitor it; or wrap storage handlers with explicit retry logic.

**`emitAndWait` in the hot path**
Using `emitAndWait` for normal emission instead of critical-only back-pressure serialises every signal through all subscribers. Symptom: high-frequency collectors (file watchers, log tailers) back up; event loop saturates. Fix: use plain `emit()` in the hot path; reserve `emitAndWait` for shutdown flush.

**Shared state between command layer and collection loop (singleton anti-pattern)**
A command function that holds a reference to a running loop object (via singleton, module-level variable, or closure over `main.ts` state) creates invisible coupling. Commands become impossible to unit-test, and restarting the loop invalidates the reference. Symptom: command functions fail after a config reload or loop restart; tests require a running Sentinel to work. Fix: command functions write to `state/paused.json` or `state/trigger.json`; the loop reads on the next tick. No shared memory needed.

**CI publish step fires on stale version**
The CI publish step skips publishing if the version already exists on npm. If the version in `package.json` is not bumped before pushing to main, the publish step exits cleanly but nothing is uploaded. Symptom: CI completes green; npm registry unchanged. Fix: bump the version in `package.json` before pushing.

---

## Monorepo Layout

```
packages/
├── core/      → @appydave/appysentinel-core   (published)   — 7 primitives + createSentinel()
├── config/    → @appydave/appysentinel-config (published)   — shared ESLint/TS/Prettier/Vitest configs
├── cli/       → create-appysentinel           (published)   — static scaffolding CLI (Layer 1 + 2)
└── template/  → minimal scaffold (NOT published)            — copied by CLI into user projects
                 Ships: src/main.ts, CLAUDE.md, scripts/launchd + scripts/systemd, .env.example
```

Core runtime deps: `pino` (structured logging), `ulid` (Signal IDs), `zod` (config validation).
Test framework: Vitest. **46 tests pass** — 39 core (8 test files in `packages/core/test/`) + 7 CLI integration (1 test file in `packages/cli/test/`).
Build: `bun run build` (tsc). Runtime: Bun recommended, Node 20+ supported.
CI: GitHub Actions on push to main (typecheck + test + auto-tag + publish). Publish is idempotent — skips already-published versions.
Pre-push: Husky hook runs `bun run test && bun run typecheck` — broken code is blocked before reaching remote.
