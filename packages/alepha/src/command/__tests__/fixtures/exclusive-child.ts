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
  // Hold until the parent sends SIGTERM, so the signal path can be tested.
  await new Promise(() => {});
}

await new Promise((resolve) => setTimeout(resolve, holdMs));

process.stdout.write(
  `${JSON.stringify({ event: "leave", pid: process.pid, at: Date.now() })}\n`,
);

await handle.release();
