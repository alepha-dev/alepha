import { Alepha } from "alepha";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { UiShowcase } from "../index.ts";
import type { ShowcaseMember } from "../ShowcaseMembers.ts";

/**
 * Driven through the REAL client, never against the data service directly.
 *
 * Two earlier versions of this backend passed their own unit tests and still
 * rendered nothing in the browser, because both tested the fake rather than
 * the path a page takes. So every assertion here goes through `LinkProvider`'s
 * virtual client, which is exactly what `useClient` hands a component.
 */
interface ShowcaseClient {
  findShowcaseMembers: (args: { query: Record<string, unknown> }) => Promise<{
    content: ShowcaseMember[];
    page: { totalElements?: number; isFirst: boolean };
  }>;
  findShowcaseMemberStats: () => Promise<{ total: number; active: number }>;
}

/**
 * ⚠️ Resolves to the PROVIDER, never to the client.
 *
 * `LinkProvider.client()` is a Proxy answering every property with a virtual
 * action, `then` included. Returning it from an `async` function makes the
 * runtime probe it for thenability, which dispatches an action literally named
 * "then" and fails with "Action then not found". So the proxy is always built
 * synchronously, after the await, and never crosses a promise boundary.
 */
const start = async () => {
  const alepha = Alepha.create().with(UiShowcase);
  await alepha.start();
  return alepha.inject(LinkProvider);
};

describe("ShowcaseController", () => {
  it("publishes its actions in the registry the browser reads", async ({
    expect,
  }) => {
    const names = (await start()).getServerLinks().map((l) => l.name);

    // The registry is what the browser resolves against. An action missing
    // from it renders as "Action not found" and an empty block.
    expect(names).toContain("findShowcaseMembers");
    expect(names).toContain("findShowcaseMemberStats");
  });

  it("answers a page through the virtual client", async ({ expect }) => {
    const api = (await start()).client() as unknown as ShowcaseClient;
    const page = await api.findShowcaseMembers({ query: { page: 0, size: 5 } });

    expect(page.content).toHaveLength(5);
    expect(page.page.totalElements).toBeGreaterThan(5);
    expect(page.page.isFirst).toBe(true);
  });

  it("serializes every column the table renders", async ({ expect }) => {
    const api = (await start()).client() as unknown as ShowcaseClient;
    const page = await api.findShowcaseMembers({ query: { page: 0, size: 1 } });

    // `schema.response` is what serializes, so a column present on the type
    // and absent from the schema blanks a table cell silently.
    expect(Object.keys(page.content[0]).sort()).toEqual([
      "createdAt",
      "email",
      "id",
      "name",
      "role",
      "status",
      "team",
    ]);
  });

  it("pages, so the second page is not the first", async ({ expect }) => {
    const api = (await start()).client() as unknown as ShowcaseClient;
    const first = await api.findShowcaseMembers({
      query: { page: 0, size: 5 },
    });
    const second = await api.findShowcaseMembers({
      query: { page: 1, size: 5 },
    });

    expect(second.content.map((m) => m.id)).not.toEqual(
      first.content.map((m) => m.id),
    );
    expect(second.page.isFirst).toBe(false);
  });

  it("filters on the server rather than returning everything", async ({
    expect,
  }) => {
    const api = (await start()).client() as unknown as ShowcaseClient;
    const all = await api.findShowcaseMembers({ query: { page: 0, size: 50 } });
    const filtered = await api.findShowcaseMembers({
      query: { page: 0, size: 50, status: "disabled" },
    });

    expect(filtered.page.totalElements).toBeLessThan(
      all.page.totalElements as number,
    );
    expect(filtered.content.every((m) => m.status === "disabled")).toBe(true);
  });

  it("sorts on the server", async ({ expect }) => {
    const api = (await start()).client() as unknown as ShowcaseClient;
    const page = await api.findShowcaseMembers({
      query: { page: 0, size: 50, sort: "name,desc" },
    });

    const names = page.content.map((m) => m.name);
    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
  });

  it("counts consistently with what it pages", async ({ expect }) => {
    const api = (await start()).client() as unknown as ShowcaseClient;
    const stats = await api.findShowcaseMemberStats();
    const all = await api.findShowcaseMembers({
      query: { page: 0, size: 100 },
    });

    expect(stats.total).toBe(all.page.totalElements);
  });
});
