import type { ServerRequest } from "alepha/server";
import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";

/**
 * User info that a resolver returns.
 * This is the input to `SecurityProvider.createUser()`.
 */
export type UserInfo = Omit<UserAccount, "sessionId"> & {
  sessionId?: string;
};

/**
 * Resolver definition for authenticating users from requests.
 */
export interface IssuerResolver {
  /**
   * Priority (lower = first). Default: 100
   */
  priority?: number;

  /**
   * Resolve user from HTTP request.
   * Return UserInfo if authenticated, null to try next resolver.
   * Throw UnauthorizedError to stop chain.
   */
  onRequest: (req: ServerRequest) => Promise<UserInfo | null>;
}
