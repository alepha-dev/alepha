import { DesktopWorkerHost } from "../../DesktopWorkerHost.ts";

declare const self: any;

new DesktopWorkerHost(self, () => import("./entry.ts")).listen();
