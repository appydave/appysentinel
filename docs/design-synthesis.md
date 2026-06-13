# AppySentinel — Design Synthesis (Post-Forensic)

This document synthesises findings from forensic research into four reference apps (AppyRadar, AngelEye, FliHub, Storyline) and proposes a design direction for the AppySentinel boilerplate.

It is **not a spec**. It surfaces patterns, proposes a tech stack spine, drafts a recipe list, and flags open design questions for the user.

---

## 1. Reference App Summary

| App | Role as reference | Core value for AppySentinel |
|-----|------------------|-----------------------------|
| **AngelEye** | ⭐ Strongest — a real telemetry collector observing Claude Code | Event normalisation envelope, multi-tier enrichment, observer-only pattern, flat-file atomic storage |
| **AppyRadar** | ⭐ Strongest — a fleet orchestrator polling 5 machines | Central-orchestrator pattern (SSH, no remote install), graceful offline handling, unified telemetry envelope, status taxonomy |
| **FliHub** | Strong — rich watcher + subprocess patterns | Chokidar-based watchers, subprocess wrapping, JSONL append-only logs, config hierarchy, machine-role coordination |
| **Storyline** | Weak — mostly a consumer, not a collector | Event-driven sync, graceful shutdown — confirms what AppySentinel is *not* |

---

## 2. Cross-Cutting Patterns Observed

Patterns that appeared in at least two of the reference apps, and are strong candidates for the boilerplate's **fertile ground**:

1. **Unified telemetry envelope** — AngelEye's `AngelEyeEvent` and AppyRadar's "unified telemetry envelope" both wrap every event/snapshot in a standard shape regardless of source. Strong candidate for *baked into the boilerplate*.
2. **Chokidar-based file watchers** — FliHub (9 watchers), Storyline, AngelEye. Consistent patterns: debounce, event filtering, Socket.io emission.
3. **JSONL append-only storage** — FliHub and AngelEye. Crash-tolerant, git-friendly, human-readable, no DB dependency.
4. **Serial async queue** — FliHub (subprocess queue) and AngelEye (hook event queue). Prevents concurrent writes to the same resource.
5. **Subprocess wrapping with streaming output** — FliHub (MLX Whisper, FFmpeg) and AppyRadar (SSH).
6. **Atomic file writes (temp + rename)** — AngelEye. Essential for crash safety.
7. **Configuration hierarchy** — FliHub: defaults → env → file. With auto-migration for schema changes.
8. **Socket.io + REST dual interface** — FliHub, AngelEye, Storyline all expose both. Socket.io for push, REST for query.
9. **Multi-tier enrichment** — AngelEye: Tier 1 deterministic → Tier 2 heuristic → Tier 3 LLM (designed, not built).
10. **Graceful offline / degraded handling** — AppyRadar's first-class offline machine treatment. FliHub's port cleanup on startup.

---

## 3. Two Architectural Shapes Surfaced

The forensics revealed **two distinct architectural shapes** for collectors, and the boilerplate will need to support both — or pick one.

### Shape A: Agent-per-Machine (FliHub, AngelEye)
- A Sentinel runs *on* the machine being observed
- Locally watches files, processes, subprocesses
- Exposes local interface (REST + Socket.io)
- Pushes telemetry outward to a central system

### Shape B: Central Orchestrator (AppyRadar)
- A single Sentinel polls *many remote machines* via SSH
- No remote install required on target machines
- Aggregates results centrally
- Exposes unified view to dashboard consumers

**Design question:** Does AppySentinel support both shapes (via recipe) or pick one as the canonical model and relegate the other to a specialised pattern?

My instinct: **Shape A is canonical** (matches the architecture brief's "Sentinel runs locally on a machine"). Shape B becomes a specialised recipe — e.g. `orchestrator-ssh` — for when you want a stateless aggregator instead.

---

## 4. Proposed Tech Stack Spine

Informed by what the reference apps actually use:

| Concern | Choice | Reasoning |
|---------|--------|-----------|
| **Language** | TypeScript | Unanimous across all four reference apps |
| **Runtime** | **Bun** | AppyRadar already uses it successfully. Faster startup, simpler DX, native TS, built-in SQLite, built-in bundler. Perfect for long-running agents |
| **HTTP / expose layer** | **Hono** on `Bun.serve` | Minimal, fast, works natively on Bun. Don't need Express for a sentinel (no heavy middleware story) |
| **Validation** | **Zod** | Matches AppyStack, proven for env + event schemas |
| **Logging** | **Pino** | Matches AppyStack; structured logs are critical for a telemetry tool |
| **File watching** | **chokidar** | Ubiquitous across reference apps; proven; no realistic alternative |
| **Subprocess** | Node/Bun `spawn` + streaming | Pattern from FliHub |
| **Testing** | **Vitest** | Matches AppyStack |
| **Quality tools** | ESLint + Prettier from `@appydave/appystack-config` | Reuse, don't reinvent |

**Explicitly NOT in the spine:**
- Socket.io (recipe territory — not every sentinel needs real-time)
- Storage (SQLite, JSONL, etc — all recipes)
- Transport protocol (HTTP-push, OTLP, Socket.io-push — all recipes)
- Runtime supervisor (launchd, PM2, systemd, Docker — all recipes)
- React / Vite / frontend (a sentinel is headless by default)

This makes AppySentinel's spine roughly: **"Bun + TypeScript + Hono + Zod + Pino + Chokidar + Vitest"** — call it BTHZPCV if we need an acronym. Or we could just call it the **Sentinel Stack**.

---

## 5. What's Baked In vs Recipe

### Baked into the boilerplate (plumbing / fertile ground)

- **Unified event envelope** — a single `SentinelEvent<T>` type all collectors emit into. Shape inspired by OTEL + AngelEye + AppyRadar.
- **Event bus** — internal pub/sub so collectors emit and transports/stores subscribe
- **Lifecycle harness** — startup, shutdown (SIGINT/SIGTERM), reload, health endpoint
- **Config loader** — hierarchical: defaults → env → file; Zod-validated; reload-on-change
- **Atomic file write helper** — temp + rename
- **Serial async queue primitive** — for any collector that needs ordered I/O
- **Logger** — Pino, pre-configured, structured

### Recipes (describe, don't implement)

**Input / collector recipes** (how data enters the Sentinel):
- `watch-directory` — chokidar-based file watcher
- `watch-logfile` — tail log files with rotation support
- `poll-http` — periodic HTTP GET against an endpoint
- `poll-command` — periodic shell command execution
- `orchestrator-ssh` — poll remote machines via SSH (AppyRadar pattern)
- `hook-receiver` — HTTP webhook receiver (AngelEye pattern)
- `subprocess-wrap` — spawn a long-running process and stream output
- `snapshot-capture` — periodic state snapshot

**Storage recipes** (how data is buffered locally):
- `jsonl-store` — append-only JSONL (FliHub / AngelEye pattern)
- `sqlite-store` — SQLite (Bun's native)
- `memory-buffer` — in-memory ring buffer (ephemeral)

**Interface recipes** (how tools talk to the Sentinel):
- `rest-interface` — REST + Swagger/OpenAPI
- `mcp-interface` — MCP server exposing resources, tools, prompts
- `socketio-interface` — Socket.io server for realtime subscribers

**Transport recipes** (how data leaves the Sentinel):
- `http-push` — POST to remote endpoint
- `socketio-push` — push via Socket.io client
- `otlp-push` — push via OpenTelemetry protocol (future)
- `supabase-push` — Supabase JSONB (AppyRadar planned)
- `file-relay` — rsync to shared folder (FliHub pattern)

**Enrichment recipes** (how raw telemetry gets classified):
- `deterministic-classifier` — rules-based enrichment (AngelEye Tier 1)
- `heuristic-classifier` — regex / pattern-based (AngelEye Tier 2)
- `llm-classifier` — semantic enrichment via LLM (AngelEye Tier 3)
- `event-normaliser` — map domain events into unified envelope

**Runtime recipes** (how the Sentinel runs):
- `register-as-launchd` — macOS daemon
- `register-as-systemd` — Linux daemon
- `register-as-pm2` — cross-platform PM2
- `register-as-docker` — containerised

**Coordination recipes** (multi-Sentinel patterns):
- `config-pull` — pull config from central system (brief mentions this)
- `machine-role` — role-based capability branching (FliHub's recorder/editor)
- `sentinel-mesh` — Sentinels discover and read from each other

---

## 6. Open Design Questions

These are decisions that should be resolved *before* writing the boilerplate spec. Each one shapes implementation.

1. **One shape or two?** — Is the canonical Sentinel always per-machine, or does the boilerplate treat orchestrator-style (AppyRadar) as a first-class alternative?
   - **Resolved 2026-06-13 (David, interview):** *Both shapes are valid; the choice is deliberately deferred per-deployment, not decided once for the framework.* Shape A (per-machine) remains the canonical *intended* design and Shape B (`orchestrator-ssh`) stays a first-class recipe — but neither is mandated. AppyRadar runs Shape B today because "one box SSHing into five works fine and nothing yet demands the switch." The framework's job is to make the *trigger to migrate* explicit rather than to pick a winner. Named triggers that flip a deployment from Shape B → Shape A (or toward D6 relay): **(a) offline blindness** — a downed/staffed remote machine yields no current data; a local sentinel keeps observing and retains local history to relay on reconnect; **(b) permission/security friction** — reaching *into* a remote machine hits escalated-permission walls and is itself a risk surface, whereas self-observation + "push for data, pull for config" needs no inbound connection; **(c) local agents want local data** — an agent on a given machine only wants *that* machine's state, with no central round-trip. Build per-machine install / D6 only when one of a/b/c actually bites. See pattern-catalogue gap #8 and D6.
2. **Unified envelope — mandatory or optional?** — Every reference app invented one. Should AppySentinel mandate a single `SentinelEvent` shape, or ship a default with an override escape hatch?
3. **Observer-only by design?** — AngelEye deliberately chose observer-only (read, never write). Is that a boilerplate *principle*, or just one posture among many?
   - **Resolved 2026-06-13 (David, interview):** *Observer is the principle, framed as ~80/20 rather than absolute.* A Sentinel is ~80% passive observer — it reacts to events (file changes) and scheduled scans, and never operates the systems it watches. The remaining ~20% lives specifically on the **Access (MCP/API/CLI)** channel, where a minority of CUD operations is legitimate — but **scoped to managing the Sentinel itself** (its config, schedule, paused hosts, local data sync), *never* to mutating the observed systems. Richer remediation/action (restart an app, free disk, run fleet commands) is deliberately pushed *outward* — to agents (once the Sentinel tells them *where* the problem is) or to the separate Viewer/UX — not built into the Sentinel. So "observer-only" is the default posture with one named, narrowly-scoped exception, not a blanket ban. This supersedes the looser "mutation is a future `mcp-tools` recipe" framing.
4. **Bun or Node?** — AppyRadar uses Bun, the AppyStack apps use Node. Bun is lean and TS-native. Node is safer. Picking Bun is a slight bet on the runtime's maturity.
5. **Default interface: REST or MCP?** — Both should be recipes, but which is the *default* when you scaffold a new Sentinel? Given the target consumers (Claude, AI tooling), MCP-first makes sense.
6. **Does AppySentinel ship a CLI (`create-appysentinel`)?** — Matching AppyStack's scaffolding model. Or does it stay template-only (copy + customise)?
7. **Upgrade mechanism?** — AppyStack has `appystack-upgrade`. Does AppySentinel need the equivalent?
8. **Is the Sentinel expected to run alongside an AppyStack dashboard, or independently?** — The brief implies they're separable. Confirm.

---

## 7. Recommended Next Step

Resolve the eight questions in §6, in order. The first three are philosophical (shape, envelope, posture). The next three are technical (runtime, default interface, CLI). The last two are scope (upgrade, integration).

Once those are answered, the boilerplate spec writes itself from:
- §4 (stack spine)
- §5 (baked vs recipe)
- The recipe list, expanded with per-recipe specs matching AppyStack's `references/*.md` format

Then, a **worked example**: "here's what an AngelEye-style collector looks like rebuilt on AppySentinel" — to stress-test the design.
