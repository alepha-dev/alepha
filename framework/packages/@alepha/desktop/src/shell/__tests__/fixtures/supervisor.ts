import { DesktopSupervisorWorker } from "../../services/DesktopSupervisorWorker.ts";

declare const self: any;

// The real supervisor terminates the window loop through libwebview; here
// the shell side is told instead, so the spec can see it happen.
new DesktopSupervisorWorker(self, (handle) =>
  self.postMessage({ type: "terminated", handle }),
).listen();
