import { Alepha, z } from "alepha";
import { MemoryDestinationProvider } from "alepha/logger";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $cookie, AlephaServerCookies } from "../index.ts";

class BudgetApp {
  session = $cookie({
    name: "session",
    schema: z.text({ size: "rich" }),
  });

  other = $cookie({
    name: "other",
    schema: z.text({ size: "rich" }),
  });

  write = $action({
    path: "/write",
    method: "POST",
    schema: { body: z.object({ data: z.text({ size: "rich" }) }) },
    handler: ({ body }) => {
      this.session.set(body.data);
    },
  });

  writeOther = $action({
    path: "/write-other",
    method: "POST",
    schema: { body: z.object({ data: z.text({ size: "rich" }) }) },
    handler: ({ body }) => {
      this.other.set(body.data);
    },
  });

  remove = $action({
    path: "/remove",
    method: "POST",
    handler: () => {
      this.session.del();
    },
  });
}

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaServer)
    .with(AlephaServerCookies)
    .with(BudgetApp);
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;

  const post = (path: string, data: string, cookie = "") =>
    fetch(`${hostname}/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ data }),
    });

  const warnings = () =>
    alepha
      .inject(MemoryDestinationProvider)
      .logs.filter(
        (entry) =>
          entry.level === "WARN" && entry.message.includes("Cookies for"),
      )
      .map((entry) => entry.message);

  return { post, warnings };
};

describe("the cookie header budget", () => {
  it("stays quiet below the threshold", async ({ expect }) => {
    const { post, warnings } = await boot();

    await post("write", "x".repeat(5000));

    expect(warnings()).toEqual([]);
  });

  it("warns above it, naming the cookie and its size, chunks counted as one", async ({
    expect,
  }) => {
    const { post, warnings } = await boot();

    await post("write", "x".repeat(7000));

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('"app.session"');
    expect(warnings()[0]).toMatch(/is 70\d\d bytes/);
  });

  it("warns once per cookie name", async ({ expect }) => {
    const { post, warnings } = await boot();

    await post("write", "x".repeat(7000));
    await post("write", "x".repeat(8000));
    await post("write-other", "x".repeat(7000));

    expect(warnings()).toHaveLength(2);
    expect(warnings()[1]).toContain('"app.other"');
  });

  it("counts what the request already carries", async ({ expect }) => {
    const { post, warnings } = await boot();

    await post("write", "small", `analytics=${"x".repeat(7000)}`);

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('"app.session"');
    expect(warnings()[0]).not.toContain("analytics");
  });

  it("does not count a cookie this response replaces", async ({ expect }) => {
    const { post, warnings } = await boot();

    await post("write", "small", `app.session=${"x".repeat(7000)}`);

    expect(warnings()).toEqual([]);
  });

  it("does not count a cookie this response deletes", async ({ expect }) => {
    const { post, warnings } = await boot();
    const chunks = [0, 1, 2].map(
      (index) => `app.session.${index}=${"x".repeat(3000)}`,
    );

    await post("remove", "", chunks.join("; "));

    expect(warnings()).toEqual([]);
  });
});
