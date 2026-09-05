import { Alepha } from "alepha";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { UiShowcase } from "../index.ts";

/**
 * The admin fixtures impersonate `alepha/api/*` controllers by action NAME, so
 * that is the only thing worth asserting here. `LinkProvider`'s virtual client
 * is a flat proxy: `client.findUsers(...)` dispatches whatever is registered
 * under `findUsers`, so a renamed or unregistered fixture renders the real
 * component with "Action not found" and an empty table - which reads as a
 * styling bug rather than a missing service.
 *
 * The names below are transcribed from the components' own call sites, not
 * from the real controllers, because the call site is what has to match.
 */
const start = async () => {
  const alepha = Alepha.create().with(UiShowcase);
  await alepha.start();
  return alepha.inject(LinkProvider);
};

/**
 * Component -> the actions it calls. Grown as pages are added; a component
 * whose page exists but whose row is missing here is the gap this table is
 * meant to make obvious.
 */
const REQUIRED: Record<string, string[]> = {
  AdminAudits: ["findAudits", "getAuditActions", "deleteAudits"],
  AdminUsers: [
    "findUsers",
    "findRoles",
    "updateUser",
    "deleteUser",
    "deleteUsers",
  ],
  AdminJobs: [
    "listJobs",
    "triggerJob",
    "listExecutions",
    "retryExecution",
    "cancelExecution",
  ],
  AdminSessions: ["findSessions", "deleteSession", "deleteSessions"],
  AdminFiles: [
    "findFiles",
    "getFileStats",
    "uploadFile",
    "deleteFile",
    "deleteFiles",
  ],
  AdminKeys: ["findApiKeys", "createApiKey", "revokeApiKey", "revokeApiKeys"],
};

/**
 * Read-only actions that take nothing but paging, so they can be smoke-called
 * generically. Calling them is the point: `$action` validates the handler's
 * return against `schema.response`, and that check is the only thing standing
 * between a plausible-looking fixture and a blank page in the browser. It has
 * already caught `jobName` vs `name` and an invented `completed` status.
 */
const LISTINGS = [
  "findUsers",
  "findAudits",
  "findSessions",
  "findApiKeys",
  "findFiles",
] as const;

describe("showcase admin fixtures", () => {
  for (const [component, actions] of Object.entries(REQUIRED)) {
    it(`registers every action ${component} calls`, async ({ expect }) => {
      const names = (await start()).getServerLinks().map((l) => l.name);

      for (const action of actions) {
        expect(names).toContain(action);
      }
    });
  }

  it("answers the audit filter's type:action pairs", async ({ expect }) => {
    const api = (await start()).client() as unknown as {
      getAuditActions: () => Promise<{ type: string; action: string }[]>;
    };
    const pairs = await api.getAuditActions();

    // `AdminAudits` swallows a failure here, so an empty result is invisible
    // in the browser: the filter simply renders with nothing in it.
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]).toHaveProperty("type");
    expect(pairs[0]).toHaveProperty("action");
  });

  it("serves users whose roles the picker can render", async ({ expect }) => {
    const api = (await start()).client() as unknown as {
      findUsers: (a: { query: Record<string, unknown> }) => Promise<{
        content: { roles: string[] }[];
      }>;
      findRoles: () => Promise<{ name: string }[]>;
    };
    const page = await api.findUsers({ query: { page: 0, size: 50 } });
    const roles = (await api.findRoles()).map((r) => r.name);

    // A user carrying a role the realm does not list renders a picker with a
    // value it cannot show.
    for (const user of page.content) {
      for (const role of user.roles) {
        expect(roles).toContain(role);
      }
    }
  });

  it("serves an execution per state the panel can act on", async ({
    expect,
  }) => {
    const api = (await start()).client() as unknown as {
      listExecutions: (a: {
        params: { name: string };
        query: Record<string, unknown>;
      }) => Promise<{ can: { retry: boolean; cancel: boolean } }[]>;
    };
    const rows = await api.listExecutions({
      params: { name: "ShowcaseJobs.sendDigest" },
      query: {},
    });

    // `can` is what decides whether a row offers retry or cancel, so the
    // fixture has to contain at least one of each or those buttons are never
    // shown on the site.
    expect(rows.some((r) => r.can.retry)).toBe(true);
    expect(rows.some((r) => r.can.cancel)).toBe(true);
  });

  for (const action of LISTINGS) {
    it(`${action} answers a page that satisfies its response schema`, async ({
      expect,
    }) => {
      const api = (await start()).client() as unknown as Record<
        string,
        (a: { query: Record<string, unknown> }) => Promise<{
          content: unknown[];
        }>
      >;

      // A schema violation throws here rather than returning something odd,
      // which is exactly the failure mode worth having in CI: in the browser
      // the same violation is a toast and an empty table.
      const page = await api[action]({ query: { page: 0, size: 5 } });

      expect(Array.isArray(page.content)).toBe(true);
      expect(page.content.length).toBeGreaterThan(0);
    });
  }

  it("derives file stats that agree with the rows", async ({ expect }) => {
    const api = (await start()).client() as unknown as {
      getFileStats: () => Promise<{
        totalFiles: number;
        byBucket: { bucket: string }[];
      }>;
      findFiles: (a: { query: Record<string, unknown> }) => Promise<{
        content: { bucket: string }[];
      }>;
    };
    const stats = await api.getFileStats();
    const all = await api.findFiles({ query: { page: 0, size: 100 } });

    // `AdminFiles` builds its bucket filter from the stats, so a bucket listed
    // there with no matching row is a filter that always returns nothing.
    const buckets = new Set(all.content.map((f) => f.bucket));
    expect(stats.totalFiles).toBe(all.content.length);
    for (const { bucket } of stats.byBucket) {
      expect(buckets.has(bucket)).toBe(true);
    }
  });
});
