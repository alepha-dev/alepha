import { $hook, Alepha, z } from "alepha";
import { $entity, $repository, db, type Repository } from "alepha/orm";
import { $owns, $role, $secure } from "alepha/security";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  LinkProvider,
  ScopeGrantsProvider,
  ServerLinksProvider,
} from "../index.ts";
import type { ApiRegistryResponse } from "../schemas/apiLinksResponseSchema.ts";

const projects = $entity({
  name: "scope_projects",
  schema: z.object({
    id: db.primaryKey(z.text()),
    title: z.text(),
  }),
});

const members = $entity({
  name: "scope_members",
  schema: z.object({
    id: db.primaryKey(z.text()),
    projectId: z.text(),
    userId: z.text(),
  }),
});

/**
 * A scope whose permission set the test sets by hand, standing in for the one
 * a page's loader would have put on an atom.
 */
class FakeScopeGrants extends ScopeGrantsProvider {
  public held: readonly string[] | undefined;

  public override current(): readonly string[] | undefined {
    return this.held;
  }
}

class Roles {
  member = $role({
    name: "member",
    permissions: [{ name: "*", ownership: true }],
  });
}

class App {
  projects = $repository(projects);
  members = $repository(members);

  protected readonly authenticate = $hook({
    on: "server:onRequest",
    priority: "first",
    handler: ({ request }) => {
      request.user = { id: "u1", realm: "default", roles: ["member"] };
    },
  });

  /**
   * Gated with `requires` ALONE - no separate `$secure` beside it. This is the
   * shape that has to land its permission in the registry, and the four links
   * that carry it there are invisible from any one of them.
   */
  createQuest = $action({
    schema: {
      params: z.object({ id: z.text() }),
      response: z.text(),
    },
    use: [
      $owns({
        repository: () => this.projects as unknown as Repository<any>,
        param: "id",
        requires: "quest:create",
        via: {
          repository: () => this.members as unknown as Repository<any>,
          resource: "projectId",
          user: "userId",
        },
      }),
    ],
    handler: ({ params }) => params.id,
  });

  /** The classic spelling, for comparison. */
  updateProject = $action({
    schema: { response: z.text() },
    use: [$secure({ permissions: ["project:update"] })],
    handler: () => "ok",
  });

  /** No permission at all: nothing for a scope to narrow. */
  ping = $action({
    schema: { response: z.text() },
    handler: () => "pong",
  });
}

const createApp = (options: { scope?: boolean } = {}) => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  });

  if (options.scope) {
    alepha.with({ provide: ScopeGrantsProvider, use: FakeScopeGrants });
  }

  alepha.with(ServerLinksProvider);
  alepha.inject(Roles);
  const app = alepha.inject(App);

  return { alepha, app, links: alepha.inject(LinkProvider) };
};

/**
 * Put a registry in the request store, which is what makes `can()` read the
 * `actionMap` branch instead of the server's own `serverLinkMap`. Both branches
 * have to narrow the same way, or SSR and the client disagree.
 */
const loadRegistryBranch = (
  alepha: Alepha,
  actions: ApiRegistryResponse["actions"],
) => {
  alepha.store.set("alepha.server.request.apiLinks", {
    prefix: "/api",
    actions,
  });
};

describe("action.can() and the current scope", () => {
  it("publishes the permission of a gate declared with requires alone", async ({
    expect,
  }) => {
    const { alepha } = createApp();
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_links`,
    );
    const registry = (await res.json()) as ApiRegistryResponse;

    // The whole chain, end to end: `requires` -> `secure.permissions` ->
    // the middleware's [OPTIONS] -> `link.secured` -> here. Break any link and
    // nothing throws; the action just arrives with no permissions and every
    // write control stays visible.
    expect(registry.actions.createQuest.permissions).toEqual(["quest:create"]);
    expect(registry.actions.updateProject.permissions).toEqual([
      "project:update",
    ]);
    expect(registry.actions.ping.permissions).toBeUndefined();
  });

  it("answers exactly as before when no scope provider is registered", async ({
    expect,
  }) => {
    const { alepha, links } = createApp();
    await alepha.start();

    // Server branch (`serverLinkMap`).
    expect(links.can("createQuest")).toBe(true);
    expect(links.can("updateProject")).toBe(true);
    expect(links.can("ping")).toBe(true);
    expect(links.can("nothingLikeThis")).toBe(false);

    // Registry branch (`actionMap`).
    loadRegistryBranch(alepha, {
      createQuest: { path: "/createQuest", permissions: ["quest:create"] },
    });
    expect(links.can("createQuest")).toBe(true);
  });

  it("hides an action whose permission the scope lacks, on both branches", async ({
    expect,
  }) => {
    const { alepha, links } = createApp({ scope: true });
    await alepha.start();

    const scope = alepha.inject(ScopeGrantsProvider) as FakeScopeGrants;
    scope.held = ["project:read"];

    // Server branch.
    expect(links.can("createQuest")).toBe(false);
    expect(links.can("updateProject")).toBe(false);
    // An action naming no permission is never narrowed: there is nothing to
    // compare, and hiding it would blank the parts of a UI that are not about
    // permissions at all.
    expect(links.can("ping")).toBe(true);

    // Registry branch, same answers.
    loadRegistryBranch(alepha, {
      createQuest: { path: "/createQuest", permissions: ["quest:create"] },
      ping: { path: "/ping" },
    });
    expect(links.can("createQuest")).toBe(false);
    expect(links.can("ping")).toBe(true);
  });

  it("shows it once the scope carries the permission, wildcards included", async ({
    expect,
  }) => {
    const { alepha, links } = createApp({ scope: true });
    await alepha.start();

    const scope = alepha.inject(ScopeGrantsProvider) as FakeScopeGrants;

    scope.held = ["quest:create"];
    expect(links.can("createQuest")).toBe(true);
    expect(links.can("updateProject")).toBe(false);

    scope.held = ["quest:*"];
    expect(links.can("createQuest")).toBe(true);
  });

  it("narrows nothing outside a scope, and everything inside an empty one", async ({
    expect,
  }) => {
    const { alepha, links } = createApp({ scope: true });
    await alepha.start();

    const scope = alepha.inject(ScopeGrantsProvider) as FakeScopeGrants;

    // ⚠️ `undefined` is "not inside a scope" and narrows nothing. `[]` is
    // "inside one, holding nothing" and hides everything that names a
    // permission. Conflating them would blank every page outside a scope.
    scope.held = undefined;
    expect(links.can("createQuest")).toBe(true);

    scope.held = [];
    expect(links.can("createQuest")).toBe(false);
    expect(links.can("ping")).toBe(true);
  });

  it("leaves the permission-string branch of can() alone", async ({
    expect,
  }) => {
    const { alepha, links } = createApp({ scope: true });
    await alepha.start();

    const scope = alepha.inject(ScopeGrantsProvider) as FakeScopeGrants;
    scope.held = [];

    // `can("group:name")` asks about the caller's APPLICATION permissions and
    // never about an action, so a scope must not touch it -
    // `permission-matching-parity.spec.ts` pins that branch against
    // `PermissionRegistryProvider`.
    loadRegistryBranch(alepha, {});
    alepha.store.set("alepha.server.request.apiLinks", {
      prefix: "/api",
      actions: {},
      permissions: ["admin:users:read"],
    });

    expect(links.can("admin:users:read")).toBe(true);
    expect(links.can("admin:*")).toBe(true);
    expect(links.can("admin:users:write")).toBe(false);
  });
});
