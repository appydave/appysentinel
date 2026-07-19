# Architecture Refactor — v0.2.0

**Status**: Complete. All three projects shipped.
**Date**: 2026-04-28 (planned) — 2026-04-29 (completed)
**Context**: Conversation session — AppySentinel architecture + vocabulary alignment.

This document is the handover for three projects that must happen in order.
Read this file at the start of any session touching this refactor.

---

## What was decided (vocabulary)

| Old | New | Why |
|-----|-----|-----|
| Expose | **Access** | Direction-neutral. Bidirectional by design (read + write). "Expose" implies passive/accidental. |
| Umbrellas | **Zones** | Zones are named by direction of data flow. No metaphor needed. |
| (unnamed) | **Bindings** | The thin protocol adapters within Access — MCP, HTTP, CLI. They own no logic. |
| (inline in recipe) | **Query** | The read layer within Access. Pure functions over snapshot data. No transport knowledge. |
| (future/deferred) | **Command** | Sentinel self-management. Controls the sentinel's own behaviour — config, schedule, triggers. Never mutates observed systems. |

**Three zones: Collect / Access / Deliver**
- **Collect** — data flows IN (unchanged, keep name)
- **Access** — bidirectional interface (replaces Expose)
- **Deliver** — data flows OUT (unchanged, keep name)

**Access sub-layers:**
```
src/access/
├── query/      ← read logic. Pure functions. No transport knowledge.
├── command/    ← write logic (opt-in). Sentinel-only. Observer-only invariant holds.
└── bindings/   ← thin protocol adapters. MCP, HTTP, CLI. Call query/ or command/.
```

---

## Named design patterns (must appear in spec)

### CQRS (within Access zone only)

The Access zone implements CQRS-lite:
- **Query** = read side. Any binding can call any query function.
- **Command** = write side. Any binding can call any command function.
- Bindings are the transport; Query/Command are the logic.
- CQRS does NOT apply to Collect or Deliver — those are separate patterns (data pipeline / push relay).
- We use the CQRS vocabulary and separation principle. We do NOT use full CQRS/event-sourcing — no separate read-model projections, no event replay.
- The observer-only invariant is the Q-side-only constraint of CQRS stated as a first principle.

**What Command is (important — easy to get wrong):**
Commands control the Sentinel itself. They do not reach through to observed systems.
- ✅ `addMachine({ name, host })` — adds a machine to the fleet config
- ✅ `triggerCollection('mary')` — fires an immediate collection cycle outside the scheduled interval
- ✅ `pauseCollection('mary')` — suspends collection on one machine
- ✅ `reloadConfig()` — reloads the sentinel's config file without restart
- ❌ `rebootMachine('mary')` — not a command, not a sentinel concern, violates observer-only
- ❌ `deployApp('mary', ...)` — not a command, sentinel is not a control plane for observed systems

Every Sentinel will have a command layer. Sentinels are headless — the command layer is how you manage them without editing config files directly. The 90/10 split (mostly read, some control) is correct, but the "some control" is not optional.

**Canonical location in spec**: §7.3 Access zone, sub-section "Design pattern: CQRS-lite"

### OpenTelemetry conventions (first-class design decision)

We follow OTel conventions. We do not depend on OTel libraries.
- Signal kinds (log, metric, event, state, span) align to OTel primitives
- `attributes` follows OTel flat k/v semantic
- `ts` (ISO 8601) mirrors OTel timestamp convention
- An `otlp-push` transport recipe can translate Signal → OTLP without loss

This is not a footnote. It is a design constraint that shapes the Signal envelope and
ensures Sentinels can participate in OTel-compatible observability stacks without
a rewrite. Any change to the Signal envelope must be checked against OTel alignment.

**Must appear in three places:**
1. `docs/appysentinel-spec.md` §4 (Tech Stack) — named design decision alongside Bun/Hono/Zod
2. `docs/appysentinel-spec.md` §6.3 — keep existing detail, but now referenced from §4 not buried
3. `packages/template/CLAUDE.md` — one rule so it appears in every scaffolded project
2. `packages/template/CLAUDE.md` — one-line rule so it appears in every scaffolded project

---

## New core type: QueryResult<T>

Add to `packages/core/src/query.ts` (new file), export from `index.ts`:

```typescript
/**
 * Standard envelope for all query function return values.
 * Bindings wrap this in their protocol format (MCP tool response, HTTP JSON, CLI text).
 * The data_age_ms and stale fields are first-class — agents need freshness metadata.
 */
export interface QueryResult<T> {
  data: T;
  generated_at: string;   // ISO — when the snapshot was written to disk
  data_age_ms: number;    // ms between generated_at and now()
  stale: boolean;         // caller sets threshold; core provides the shape
}
```

---

## Project 1 — AppySentinel (this repo)

**Absolute path**: `/Users/davidcruwys/dev/ad/apps/appysentinel`

### 1a. Spec (`docs/appysentinel-spec.md`)

| Section | Change |
|---------|--------|
| §1 | "exposes it for queries (API / CLI / MCP)" → "makes it accessible via the Access zone (API / CLI / MCP)" |
| §3 canonical architecture | Update diagram: EXPOSES → ACCESSES |
| §3 rules | "Observer-only — Sentinels read, never mutate" — add: "This is the Q-side constraint of CQRS, applied by default." |
| §4 Tech Stack | Add explicit row: "OTel alignment — conventions followed (signal kinds, attributes, timestamps); no OTel library dependency" |
| §7.0 header | "Three umbrellas: Collect / Expose / Deliver" → "Three zones: Collect / Access / Deliver" |
| §7.0 body | Drop "What is an umbrella?" paragraph. Replace with single statement: zones are named by direction of data flow. Keep Collect/Access/Deliver definitions. |
| §7.0 "open design decision — Expose as a control surface" | Resolve it: Access is bidirectional by design. Query = read, Command = write. Command is opt-in, never default. |
| §7.3 header | "Expose recipes (3)" → "Access zone" |
| §7.3 body | Rewrite. Three sub-layers: Bindings (thin protocol adapters), Query (read logic), Command (write logic). Name CQRS-lite explicitly here. Add QueryResult<T> reference. |
| §7.3 recipe table | Rename: `api-expose` → `api-binding`, `cli-expose` → `cli-binding`, `mcp-expose` → `mcp-binding`. One-line spec updates to say "thin adapter, routes to query/ or command/". |

### 1b. Core (`packages/core/src/`)

- New file: `packages/core/src/query.ts` — exports `QueryResult<T>`
- Update `packages/core/src/index.ts` — re-export `QueryResult`
- No existing API changes

### 1c. Template (`packages/template/src/`)

Add folder skeleton. All empty (a `// Wire recipes here.` stub index file in each):

```
src/
├── collect/
├── access/
│   ├── query/
│   ├── command/
│   └── bindings/
├── deliver/
├── __tests__/          ← already exists
└── main.ts             ← already exists
```

### 1d. Template CLAUDE.md (`packages/template/CLAUDE.md`)

Replace "Three recipe categories (umbrellas)" section with:

```
## Three zones

- **Collect** — data flows IN. Recipes in src/collect/.
- **Access** — bidirectional interface layer. src/access/ has three sub-layers:
    - query/    — read logic. Pure functions over snapshots. Returns QueryResult<T>. No transport knowledge.
    - command/  — sentinel self-management. Config changes, triggered collections, pause/resume. Never mutates observed systems.
    - bindings/ — thin protocol adapters. MCP, HTTP, CLI. Call query/ or command/, translate to protocol.
  Design pattern: CQRS-lite — Query is the read side, Command is the write side.
  CQRS applies to Access only. Collect and Deliver are separate patterns.
- **Deliver** — data flows OUT. Recipes in src/deliver/.

OpenTelemetry: we follow OTel conventions (signal kinds, attributes, timestamps).
We do not depend on OTel libraries.
```

Also update "Hard rules" section: replace "Run `bun src/main.ts` after every recipe addition" with a note pointing to correct zone folders.

### 1e. Root CLAUDE.md

- "Three boundary umbrellas" → "Three zones"
- "Expose = API/CLI/MCP only (Anthropic framework)" → "Access zone = Bindings (API/CLI/MCP) over Query + Command layers. Bindings are thin adapters; logic belongs in query/ or command/."
- Add to architectural rules: "CQRS applies within Access only — not to Collect or Deliver."

### 1f. Pattern catalogue (`docs/pattern-catalogue.md`)

- Section header: "Expose (boundary umbrella 2 — §7.3)" → "Access (zone 2 — §7.3)"
- E1 `api-expose` → `api-binding`
- E2 `cli-expose` → `cli-binding`
- E3 `mcp-expose` → `mcp-binding`
- Add patterns:
  - **A4** `query-layer` — `src/access/query/` convention, returns QueryResult<T>
  - **A5** `command-layer` — `src/access/command/` convention, sentinel-only writes
- Capability matrix: update Expose → Access column header

### 1g. configure-sentinel SKILL.md (`packages/template/.claude/skills/configure-sentinel/SKILL.md`)

- Q4 "How will this Sentinel be read?" — update bindings list: `mcp-binding`, `api-binding`, `cli-binding`
- After Q4, add Q4a: "Will the binding need a query layer, or is the snapshot simple enough to serve directly?" (for simple Sentinels, a binding can read the snapshot directly without a query/ layer — the folder is there when needed)
- Note: CQRS terminology should appear in the skill intro

### 1h. Version bump

Both `@appydave/appysentinel-core` and `create-appysentinel` → **0.2.0**
- Core: new `QueryResult<T>` export (minor, backward-compatible)
- CLI: template folder structure changes (minor)
- `PUBLISHED_VERSIONS` in scaffold.ts: update core to `^0.2.0` after core publishes

---

## Project 2 — AppyRadar Sentinel

**Absolute path**: `/Users/davidcruwys/dev/ad/apps/appyradar-sentinal`
**AppySentinel boilerplate**: `/Users/davidcruwys/dev/ad/apps/appysentinel`

**Prerequisite**: Project 1 must be published (0.2.0 on npm) before this project updates its dependency.

### Folder rename

```
src/expose/         → src/access/bindings/
src/ (new)          → src/access/query/
src/ (new)          → src/access/command/    (empty, placeholder)
src/ (new)          → src/collect/           (move collectors/ here, or keep collectors/ — see note)
```

Note on `collectors/`: the current name is fine and matches the zone. Either rename to `collect/` for strict convention adherence, or keep `collectors/` as a valid sub-directory within the collect zone. Decision needed at implementation time.

### Extract query layer

`src/access/bindings/mcp.ts` currently inlines all data-shaping logic.
Extract into `src/access/query/fleet.ts`:
- `getFleetStatus()` → returns `QueryResult<FleetStatus>`
- `getMachineDetail(name)` → returns `QueryResult<MachineDetail>`
- `getAlerts()` → returns `QueryResult<Alert[]>`

`src/access/bindings/mcp.ts` becomes thin: calls query functions, wraps in MCP tool response format.

### Import update

Update core dependency to `^0.2.0` in `package.json` once 0.2.0 is published.
Import `QueryResult` from `@appydave/appysentinel-core`.

---

## Project 3 — Mochaccino views

**Do this last — after Projects 1 and 2 are complete.**

All five views need vocabulary updates (Expose → Access, umbrellas → zones).
View 02 needs the Access sub-layer diagram added.
View 03 needs E1/E2/E3 renamed to A1/A2/A3 (or binding-1/2/3 — decide at implementation time).
View 04 needs the recipe catalog Access section rewritten.

---

## Execution notes

- Do not update Mochaccino views until spec + catalogue are stable (Projects 1 and 2 done).
- Each project is a separate Claude session. Read this file at the start of each.
- After Project 1 is committed, tag 0.2.0 and publish before starting Project 2.
- The `PUBLISHED_VERSIONS` update in scaffold.ts must only happen after `@appydave/appysentinel-core@0.2.0` is on npm.
