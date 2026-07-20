/**
 * @appydave/appysentinel-core — Sentinel runtime library entry point.
 *
 * Exports ONLY Sentinel's own runtime: the Signal envelope, the event bus, the
 * `createSentinel()` factory, and the query result type. Shared foundation
 * primitives (lifecycle, config, logger, atomic-write, serial-queue) live in
 * `@appydave/core` — import those directly from there. One symbol, one home:
 * this package deliberately does NOT re-export core, so there is a single
 * import path per symbol.
 */

export {
  type Signal,
  type SignalKind,
  type SignalSeverity,
  type SignalPayload,
  type SignalInput,
  type SignalContext,
  SIGNAL_SCHEMA_VERSION,
  mintSignal,
} from './signal.js';

export {
  type SignalBus,
  type SignalBusOptions,
  type SignalHandler,
  type BusErrorHook,
  createSignalBus,
} from './bus.js';

// NOTE: foundation primitives (lifecycle, config, logger, atomic-write,
// serial-queue) are NOT re-exported here. Import them from '@appydave/core'.

export {
  type Sentinel,
  type CreateSentinelOptions,
  createSentinel,
} from './create-sentinel.js';

export { type QueryResult } from './query.js';
