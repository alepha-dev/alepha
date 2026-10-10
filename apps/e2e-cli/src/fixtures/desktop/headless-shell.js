// The desktop e2e's shell entry, injected at compile time in place of the
// generated one (`compileDesktop({ headless })`). Everything is the real
// desktop shell, supervisor, server Worker and admission guard, except the
// window: this one drives the app over HTTP as the webview would, records
// what it saw in DESKTOP_FIXTURE_RESULT, and closes.
import { writeFileSync } from "node:fs";

import {
  AlephaDesktopShell,
  DesktopShell,
  SupervisorProvider,
  WindowProvider,
} from "@alepha/desktop/shell";
import { Alepha } from "alepha";

class HeadlessWindow extends WindowProvider {
  url = "";

  async open() {}

  navigate(url) {
    this.url = url;
  }

  async run() {
    const bootstrap = new URL(this.url);
    const origin = bootstrap.origin;
    const result = { origin, unauthorized: {} };

    for (const path of ["/", "/no/such/page", "/api/inc"]) {
      result.unauthorized[path] = (await fetch(`${origin}${path}`)).status;
    }
    result.unauthorized.OPTIONS = (
      await fetch(`${origin}/`, { method: "OPTIONS" })
    ).status;

    const boot = await fetch(this.url, { redirect: "manual" });
    result.bootstrap = boot.status;
    result.replay = (await fetch(this.url, { redirect: "manual" })).status;
    const cookie = boot.headers.get("set-cookie")?.split(";")[0] ?? "";

    const page = await fetch(`${origin}/`, { headers: { cookie } });
    const html = await page.text();
    result.page = {
      status: page.status,
      greeting: html.includes("Hello, Alepha desktop!"),
    };
    const entry = html.match(/<script[^>]*src="(\/[^"]+\.js)"/)?.[1];
    const asset = entry
      ? await fetch(`${origin}${entry}`, { headers: { cookie } })
      : undefined;
    result.asset = {
      path: entry,
      status: asset?.status,
      bytes: (await asset?.text())?.length ?? 0,
    };

    const counts = [];
    for (let i = 0; i < 2; i++) {
      // `inc` takes no body, so its action is a GET.
      const inc = await fetch(`${origin}/api/inc`, {
        headers: { cookie, origin },
      });
      counts.push(inc.ok ? (await inc.json()).count : inc.status);
    }
    result.counts = counts;
    result.hostileOrigin = (
      await fetch(`${origin}/`, {
        headers: { cookie, origin: "http://127.0.0.1:1" },
      })
    ).status;
    result.cwd = process.cwd();

    writeFileSync(process.env.DESKTOP_FIXTURE_RESULT, JSON.stringify(result));
  }

  handle() {
    return 0;
  }

  async alert(title, message) {
    console.error(`ALERT ${title}: ${message}`);
  }

  destroy() {}
}

const alepha = Alepha.create({
  env: { NODE_ENV: "production", LOG_LEVEL: "info" },
})
  .with({ provide: WindowProvider, use: HeadlessWindow })
  .with(AlephaDesktopShell);
await alepha.start();
alepha.inject(SupervisorProvider).supervisorUrl = new URL(
  "./desktop-supervisor.js",
  import.meta.url,
).href;
const code = await alepha.inject(DesktopShell).run({
  config: { name: "Desktop Fixture", identifier: "dev.alepha.desktop-fixture" },
  workerUrl: new URL("./desktop-worker.js", import.meta.url).href,
});
process.exit(code);
