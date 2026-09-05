import { $inject, z } from "alepha";
import {
  identityQuerySchema,
  identityResourceSchema,
  realmConfigSchema,
} from "alepha/api/users";
import { $action } from "alepha/server";

import { SHOWCASE_REALM } from "@/web/pages/blocks/showcaseRealm.ts";

import { ShowcaseUsers } from "./ShowcaseUsers.ts";

/**
 * Stands in for `AdminIdentityController` and `RealmController`.
 *
 * Both exist for one page: `AdminUserDetail`, which holds five clients at once
 * (users, sessions, identities, audits, realm) and is the largest component in
 * the admin block. Without these its Security tab renders empty and its realm
 * query fails.
 *
 * ⚠️ `identityResourceSchema` OMITS `password`. That omission is the point of
 * having a resource schema separate from the entity, and borrowing it means the
 * showcase cannot invent a field the real API refuses to send.
 */
export class ShowcaseIdentitiesController {
  protected readonly users = $inject(ShowcaseUsers);

  public readonly findIdentities = $action({
    path: "/admin/identities",
    schema: {
      query: identityQuerySchema.extend({
        userRealmName: z.string().optional(),
      }),
      response: z.page(identityResourceSchema),
    },
    handler: ({ query }) => {
      const userId =
        (query as Record<string, any>).userId ?? this.users.rows()[0].id;
      const content = [
        {
          id: "00000000-0000-4000-c100-000000000001",
          version: 1,
          createdAt: "2026-01-01T09:30:00.000Z",
          updatedAt: "2026-01-01T09:30:00.000Z",
          userId,
          provider: "credentials",
          providerUserId: undefined,
          providerData: undefined,
        },
        {
          id: "00000000-0000-4000-c100-000000000002",
          version: 1,
          createdAt: "2026-03-14T11:05:00.000Z",
          updatedAt: "2026-03-14T11:05:00.000Z",
          userId,
          provider: "github",
          providerUserId: "1024",
          providerData: { login: "ada" },
        },
      ];
      return {
        content,
        page: {
          number: 0,
          size: 20,
          offset: 0,
          numberOfElements: content.length,
          totalElements: content.length,
          totalPages: 1,
          isEmpty: false,
          isFirst: true,
          isLast: true,
        },
      } as any;
    },
  });

  public readonly deleteIdentity = $action({
    method: "DELETE",
    path: "/admin/identities/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  /**
   * The same realm the auth screens render against, so the two halves of the
   * site cannot disagree about what this realm allows.
   */
  public readonly getRealmConfig = $action({
    path: "/realms/config",
    schema: {
      query: z.object({ userRealmName: z.string().optional() }),
      response: realmConfigSchema,
    },
    // The SAME object the auth screens render against, so the two halves of the
    // site cannot disagree about what this realm allows. It also carries the
    // full settings default: a partial literal fails response validation with
    // "Invalid input at /settings/email", which is how the first version of
    // this fixture was found.
    handler: () => SHOWCASE_REALM as any,
  });
}
