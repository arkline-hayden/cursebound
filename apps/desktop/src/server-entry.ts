// Entry of the bundled local authority (build/server/server.mjs) that the desktop shell runs in an Electron
// utilityProcess. Same process behaviour as `tsx apps/server/src/main.ts`: port report on stdout, clean shutdown on
// the `shutdown` message (over parentPort here, since a utilityProcess has no stdin).
import { runMain } from '../../server/src/main';

runMain();
