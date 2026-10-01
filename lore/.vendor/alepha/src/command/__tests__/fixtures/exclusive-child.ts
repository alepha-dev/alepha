/**
 * A minimal program that joins the exclusive queue, holds it, and leaves.
 *
 * Spawned by exclusive-cross-process.spec.ts. It reports the wall-clock
 * instants it entered and left the critical section on stdout, one JSON object
 * per line, so the parent can assert the held windows never overlap.
 *
 * Files under `fixtures` are exempt from the no-Date.now() rule, and the raw
 * clock is the point here: the assertion is about real elapsed time across
 * separate processes, which is exactly what an injectable clock cannot model.
 */
import { Alepha } from "alepha";

// Relative, not "alepha/command": the build's module analyser scans every file
// in the module, `fixtures` included, so importing this module's own package
// entry from inside it registers `command -> command` and fails the cycle
// check. The relative path stays within the module boundary, which is what
// `detectEscapingImports` requires.
import { ExclusiveProvider } from "../../providers/ExclusiveProvider.ts";

const key = process.argv[2];
const holdMs = Number(process.argv[3]);

const alepha = Alepha.create();
const exclusive = alepha.inject(ExclusiveProvider);

const handle = await exclusive.acquire(key, {
  command: `child-${process.pid}`,
  cwd: process.cwd(),
});

process.stdout.write(
  `${JSON.stringify({ event: "enter", pid: process.pid, at: Date.now() })}\n`,
);

if (process.env.CHILD_WAIT_FOR_SIGNAL) {
  // Hold until the parent signals, so the signal paths can be tested.
  //
  // A referenced timer, not a promise nobody resolves. The heartbeat interval
  // is unref'd, so a bare `new Promise(() => {})` leaves the event loop empty:
  // Node decides the program is finished, runs the `exit` handler - which
  // unlinks the ticket - and warns about an unsettled top-level await. The
  // queue was then already free before any signal arrived, so a test asserting
  // that a signal frees it passed without ever exercising a signal.
  await new Promise((resolve) => {
    setTimeout(resolve, 600_000);
  });
}

if (process.env.CHILD_STALL_MS) {
  // Block the event loop rather than await a timer. A saturated machine
  // starves a holder exactly like this, and it is what used to get the holder
  // swept: no beat can fire from inside a spin, so its heartbeat freezes while
  // the process is perfectly alive.
  const until = Date.now() + Number(process.env.CHILD_STALL_MS);
  while (Date.now() < until) {
    // spin
  }
}

await new Promise((resolve) => setTimeout(resolve, holdMs));

process.stdout.write(
  `${JSON.stringify({ event: "leave", pid: process.pid, at: Date.now() })}\n`,
);

await handle.release();
