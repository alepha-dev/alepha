import { beforeEach, describe, it } from "vitest";

import { $hook, AlephaError, run } from "../index.browser.ts";

class BrokenOnReady {
  protected readonly onReady = $hook({
    on: "ready",
    handler: () => {
      throw new AlephaError("broken on ready");
    },
  });
}

class Healthy {}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("run in a browser", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("puts a plain message with a reload button on a blank page when the start fails", async ({
    expect,
  }) => {
    run(BrokenOnReady, { env: { LOG_LEVEL: "silent" } });
    await settle();

    const box = document.querySelector("[data-alepha-start-failed]");
    expect(box?.getAttribute("role")).toBe("alert");
    expect(box?.textContent).toContain("The app could not start.");
    expect(box?.querySelector("button")?.textContent).toBe("Reload");
  });

  it("leaves a page that shows something alone", async ({ expect }) => {
    document.body.innerHTML = '<div id="root"><p>server rendered</p></div>';

    run(BrokenOnReady, { env: { LOG_LEVEL: "silent" } });
    await settle();

    expect(document.querySelector("[data-alepha-start-failed]")).toBeNull();
  });

  it("writes nothing when the start succeeds", async ({ expect }) => {
    const alepha = run(Healthy, { env: { LOG_LEVEL: "silent" } });
    await settle();

    expect(document.querySelector("[data-alepha-start-failed]")).toBeNull();
    await alepha.stop();
  });
});
