// Command layer — Sentinel self-management.
//
// Commands control THIS Sentinel, never the systems it observes.
// Examples: trigger an immediate collection, pause collection, adjust config.
//
// RULE: command functions are stateless. Effects reach the collection loop
// via files in src/state/ — commands write, the loop reads. No shared memory.
// No module-level mutable variables. No closure-captured state.
//
// Pattern:
//
//   import { atomicWrite } from '@appydave/core';
//   import { join } from 'node:path';
//
//   export async function triggerCollection(stateDir: string): Promise<void> {
//     await atomicWrite(
//       join(stateDir, 'trigger.json'),
//       JSON.stringify({ requestedAt: new Date().toISOString() })
//     );
//   }
//
//   export function consumeTrigger(stateDir: string): { requestedAt: string } | null {
//     const file = join(stateDir, 'trigger.json');
//     try {
//       const data = JSON.parse(Bun.file(file).toString());
//       unlinkSync(file);
//       return data;
//     } catch {
//       return null;
//     }
//   }
//
// Wire command functions in src/main.ts and expose them via src/access/bindings/.
// The collection loop in main.ts calls consumeTrigger() at the top of each tick.
