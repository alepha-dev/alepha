import { $inject } from "alepha";
import { oauthClientEntity, OAuthScopeResolver } from "alepha/api/oauth";
import { parameters } from "alepha/api/parameters";
import { RealmProvider } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import {
  EffectivePermissionsProvider,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { ForbiddenError } from "alepha/server";

/**
 * The signed session ID is a revocable OAuth grant identity. Inspect only
 * public grant columns, without reading refresh tokens or seeding settings.
 */
export class AutomationOAuthAuthority {
  protected readonly realms = $inject(RealmProvider);
  protected readonly clients = $repository(oauthClientEntity);
  protected readonly parameters = $repository(parameters);
  protected readonly scopes = $inject(OAuthScopeResolver);
  protected readonly effective = $inject(EffectivePermissionsProvider);
  protected readonly security = $inject(SecurityProvider);
  protected readonly time = $inject(DateTimeProvider);
  public async resolve(input: {
    id: string;
    userId: string;
    roles: string[];
    realm?: string;
    originalScope?: string[];
    clientId?: string;
  }): Promise<UserAccountToken> {
    const realm = this.realms.getRealm(input.realm);
    const session = (
      await realm.repositories.sessions.findMany({
        where: { id: input.id, userId: input.userId },
        columns: [
          "id",
          "userId",
          "clientId",
          "scopes",
          "createdAt",
          "lastUsedAt",
          "expiresAt",
        ],
        limit: 1,
      })
    )[0];
    if (
      !session?.clientId ||
      (input.clientId && session.clientId !== input.clientId)
    )
      throw new ForbiddenError("Authoring OAuth grant is unavailable");
    if (new Date(session.expiresAt).getTime() <= this.time.nowMillis())
      throw new ForbiddenError("Authoring OAuth grant is expired");
    const client = (
      await this.clients.findMany({
        where: { clientId: session.clientId, realm: realm.name },
        columns: ["clientId", "realm", "revokedAt", "scopes"],
        limit: 1,
      })
    )[0];
    if (!client || client.revokedAt)
      throw new ForbiddenError("Authoring OAuth client is unavailable");
    let settings = realm.settings;
    if (realm.settingsParameter) {
      const parameter = (
        await this.parameters.findMany({
          where: {
            name: realm.settingsParameter.options.name,
            activationDate: { lte: this.time.nowISOString() },
          },
          orderBy: [
            { column: "activationDate", direction: "desc" },
            { column: "version", direction: "desc" },
          ],
          limit: 1,
        })
      )[0];
      if (parameter) {
        const parsed = realm.settingsParameter.options.schema.safeParse(
          parameter.content,
        );
        if (!parsed.success)
          throw new ForbiddenError("OAuth realm settings require review");
        settings = parsed.data;
      }
    }
    const idle = settings.refreshToken?.expirationIdle;
    if (
      idle &&
      this.time.nowMillis() -
        new Date(session.lastUsedAt ?? session.createdAt).getTime() >
        idle
    )
      throw new ForbiddenError("Authoring OAuth grant is idle-expired");
    const currentScope = this.scopes.resolve(
      (session.scopes ?? []).filter((scope) => client.scopes.includes(scope)),
    );
    const user: UserAccountToken = {
      id: input.userId,
      roles: input.roles,
      realm: realm.name,
      sessionId: session.id,
      ownership: true,
      ...(currentScope !== undefined ? { permissionScope: currentScope } : {}),
      credential: { type: "oauth", clientId: session.clientId },
    };
    return {
      ...user,
      permissionScope: this.effective.resolve({
        user,
        narrow: [
          (permission) =>
            this.security.isInPermissionScope(permission, input.originalScope),
        ],
      }),
    };
  }
}
