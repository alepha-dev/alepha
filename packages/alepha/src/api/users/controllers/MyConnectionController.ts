import { $inject, Alepha, z } from "alepha";
import { OAuthClientService } from "alepha/api/oauth";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { RealmProvider } from "../providers/RealmProvider.ts";
import { myConnectionSchema } from "../schemas/myConnectionSchema.ts";

/**
 * Self-service "connected apps" — every OAuth client holding a live session
 * on the caller's account, and the ability to cut one off.
 *
 * ### Why it lives in `api/users` and not in `api/oauth`
 *
 * A connection needs both halves: a `sessions` row, owned here, named by an
 * `oauth_clients` row, owned by `api/oauth`. Either module could host it, and
 * the first attempt put it in `api/oauth` — reasoning that "OAuth mints
 * sessions for users" made `oauth → users` the natural direction.
 *
 * **That is backwards, and `yarn build` proved it.** `api/users` already
 * imports `api/oauth`: {@link $realm} pulls in `AlephaOAuth`,
 * `OAuthClientService` and `oauthOptions` to wire a realm's authorization
 * server. Adding the reverse edge produced
 * `Circular dependency detected: api/oauth -> api/users -> api/oauth` from the
 * build's "analyze modules" step.
 *
 * So the direction is fixed by what already exists: **users depends on oauth**,
 * and importing `oauthClientEntity` from `alepha/api/oauth` here is the same
 * edge `$realm` already relies on. It must stay one-way — a cycle is not a
 * lint warning but a crash, a primitive factory resolving to `undefined` at
 * class-field-init time, surfacing in an unrelated file.
 *
 * Cross-module imports go through the **package specifier**
 * (`alepha/api/oauth`), never a deep relative path: the same build step
 * rejects a relative import that leaves its module directory — *"Relative
 * imports must stay within the module boundary. Use a package import
 * instead"*.
 *
 * ### The UI gate is on the action, and no longer free
 *
 * `@alepha/ui`'s account router hides its Connections page behind
 * `listMyConnections.can()`, which resolves against `/api/_links`. While this
 * controller lived in `api/oauth`, an application that never mounted that
 * module got the page hidden for nothing. Registered here it is always
 * present wherever `api/users` is — which in practice is the same thing,
 * since `$realm` mounts `AlephaOAuth` anyway, but it is now a property of the
 * users module rather than a guarantee the placement provides.
 */
export class MyConnectionController {
  protected readonly alepha = $inject(Alepha);
  protected readonly realmProvider = $inject(RealmProvider);

  protected sessions(realm?: string) {
    return this.realmProvider.sessionRepository(realm);
  }

  listMyConnections = $action({
    method: "GET",
    path: "/users/me/connections",
    use: [$secure()],
    description: "List the OAuth clients connected to the caller's account",
    schema: {
      response: z.array(myConnectionSchema),
    },
    handler: async ({ user }) => {
      const rows = await this.sessions(user.realm).findMany({
        where: {
          userId: { eq: user.id },
          clientId: { isNotNull: true },
        },
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });
      if (rows.length === 0) {
        return [];
      }

      const clientIds = [
        ...new Set(
          rows
            .map((session) => session.clientId)
            .filter((id): id is string => typeof id === "string"),
        ),
      ];
      const nameByClientId = await this.resolveNames(clientIds);

      return rows.map((session) => {
        const clientId = session.clientId as string;
        return {
          id: session.id,
          clientId,
          // A session outlives a deleted client registration, and an entry
          // with a blank name would look like a rendering bug rather than a
          // connection you can still revoke.
          clientName: nameByClientId.get(clientId) ?? clientId,
          createdAt: session.createdAt,
          lastUsedAt: session.lastUsedAt,
          expiresAt: session.expiresAt,
          ip: session.ip,
          userAgent: session.userAgent as never,
          current: session.id === user.sessionId,
        };
      });
    },
  });

  revokeMyConnection = $action({
    method: "DELETE",
    path: "/users/me/connections/:id",
    use: [$secure()],
    description: "Cut off one OAuth client's access to the caller's account",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, user }) => {
      const repo = this.sessions(user.realm);

      /*
        Three conditions, all load-bearing. `userId` keeps this owner-scoped,
        so another account's session id reads as missing rather than
        forbidden — a distinct answer would confirm the id exists.

        `clientId: isNotNull` keeps this endpoint to connections only: without
        it, "revoke a connected app" would happily delete the browser session
        the caller is sitting in, which belongs to the sessions page and its
        own confirmation, not to this one.
      */
      const session = await repo.findOne({
        where: {
          id: { eq: params.id },
          userId: { eq: user.id },
          clientId: { isNotNull: true },
        },
      });
      if (!session) {
        throw new NotFoundError("Connection not found");
      }

      await repo.deleteById(session.id);
      return { ok: true };
    },
  });

  /**
   * Display names for the given client ids, resolved only when the OAuth
   * module is actually mounted.
   *
   * ⚠️ **Do not turn this back into a `$repository(oauthClientEntity)` field.**
   * A repository declaration *registers the entity*, so putting one here adds
   * an `oauth_clients` table to the schema of every application that mounts
   * `api/users` — including ones with no OAuth at all. `yarn check:migrations`
   * caught exactly that in `apps/examples/playground` and `apps/examples/shop`, which suddenly
   * wanted a migration for a table they can never read.
   *
   * Going through `OAuthClientService` instead keeps the entity owned by the
   * module that declares it: the service is registered by `AlephaOAuth`, so
   * `alepha.has(...)` is false when OAuth is absent and the map comes back
   * empty — callers already fall back to the raw client id.
   */
  protected async resolveNames(
    clientIds: string[],
  ): Promise<Map<string, string>> {
    if (!this.alepha.has(OAuthClientService)) {
      return new Map();
    }
    const clients = this.alepha.inject(OAuthClientService);
    const entries = await Promise.all(
      clientIds.map(async (clientId) => {
        const client = await clients.findByClientId(clientId);
        return [clientId, client?.clientName] as const;
      }),
    );
    return new Map(
      entries.filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
  }
}
