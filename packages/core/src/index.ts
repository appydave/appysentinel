/**
 * @appydave/appysentinel-core — runtime library entry point.
 *
 * Re-exports every primitive plus the `createSentinel()` factory. Most
 * scaffolded projects only need the default factory and the Signal types.
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

// Shared foundation primitives now live in @appydave/core (extracted by copy,
// then de-duplicated). Re-exported here so the appysentinel-core public API is
// unchanged — consumers keep importing them from '@appydave/appysentinel-core'.
export {
  type Lifecycle,
  type LifecycleStatus,
  type StopReason,
  type HealthReport,
  type StartHook,
  type StopHook,
  type ReloadHook,
  type CreateLifecycleOptions,
  createLifecycle,
  type ConfigLoader,
  type ConfigLoaderOptions,
  createConfigLoader,
  z,
  atomicWrite,
  type AtomicWriteOptions,
  SerialQueue,
  createLogger,
  type Logger,
  type LogLevel,
  type CreateLoggerOptions,
} from '@appydave/core';

export {
  type Sentinel,
  type CreateSentinelOptions,
  createSentinel,
} from './create-sentinel.js';

export { type QueryResult } from './query.js';
