import { describe, it } from "vitest";

import { CspGuard } from "../CspGuard.ts";

/**
 * A page that records its init script and replays console messages, so the
 * guard's bookkeeping is tested without a browser (the e2e suites drive the
 * real one).
 */
class FakePage {
  public initScripts = 0;
  protected listener?: (message: { type(): string; text(): string }) => void;

  public url() {
    return "http://localhost/page";
  }

  public async addInitScript() {
    this.initScripts++;
  }

  public on(_event: "console", listener: FakePage["listener"]) {
    this.listener = listener;
  }

  public log(text: string) {
    this.listener?.({ type: () => "error", text: () => text });
  }
}

describe("CspGuard", () => {
  it("passes a page with no violation", async ({ expect }) => {
    const guard = new CspGuard();
    const page = new FakePage();
    await guard.install(page);
    page.log("an ordinary error");

    expect(page.initScripts).toBe(1);
    expect(() => guard.assertClean()).not.toThrow();
  });

  it("fails on the listener's report, naming the directive and the blocked URI", async ({
    expect,
  }) => {
    const guard = new CspGuard();
    const page = new FakePage();
    await guard.install(page);
    page.log(
      `${CspGuard.MARK}${JSON.stringify({ directive: "img-src", blockedURI: "blob:http://localhost/1" })}`,
    );
    page.log(
      `${CspGuard.MARK}${JSON.stringify({ directive: "script-src-elem", blockedURI: "inline" })}`,
    );

    expect(() => guard.assertClean()).toThrow(
      "Content Security Policy violation on http://localhost/page: img-src blocked blob:http://localhost/1, and 1 more",
    );
  });

  it("fails on the browser's own report when the listener saw nothing", async ({
    expect,
  }) => {
    const guard = new CspGuard();
    const page = new FakePage();
    await guard.install(page);
    page.log(
      "Loading the script 'https://evil.example/x.js' violates the following Content Security Policy directive: \"script-src 'self'\".",
    );

    expect(() => guard.assertClean()).toThrow(
      /script-src blocked https:\/\/evil\.example\/x\.js/,
    );
  });
});
