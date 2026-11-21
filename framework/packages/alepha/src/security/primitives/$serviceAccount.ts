import { $context, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";
import type { IssuerPrimitive } from "./$issuer.ts";

/**
 * Allow to get an access token for a service account.
 *
 * You have some options to configure the service account:
 * - an OAuth2 token URL, called with the client credentials grant
 * - a local `$issuer` and the user to mint a token for
 *
 * @example
 * ```ts
 * import { $serviceAccount } from "alepha/security";
 *
 * class MyService {
 *   serviceAccount = $serviceAccount({
 *     oauth2: {
 *       url: "https://example.com/oauth2/token",
 *       clientId: "your-client-id",
 *       clientSecret: "your-client-secret",
 *     }
 *   });
 *
 *   async fetchData() {
 *     const token = await this.serviceAccount.token();
 *   }
 * }
 * ```
 */
export const $serviceAccount = (
  options: ServiceAccountPrimitiveOptions,
): ServiceAccountPrimitive => {
  const { alepha } = $context();
  const store: {
    cache?: { access_token: string; expires_at: number };
  } = {};
  const dateTimeProvider = alepha.inject(DateTimeProvider);
  const gracePeriod = options.gracePeriod ?? 30;

  /**
   * Keeps a token until `issuedAt + expiresIn`, both in seconds.
   *
   * `expiresIn` is whatever the token endpoint sent: a number, or for some
   * providers a numeric string, which must not be added to the issue time as
   * text. A value that reaches here and is neither, or is not positive (a
   * negative number, `"0"`, `"soon"`), gives no date to expire the token on,
   * so it is not kept: the caller gets it, and the next call asks for a new
   * one. A response with no `expires_in` at all, `0` or `""` never reaches
   * here: the OAuth2 path refuses it as an invalid response.
   */
  const cacheToken = (
    accessToken: string,
    expiresIn: unknown,
    issuedAt: number = dateTimeProvider.now().unix(),
  ) => {
    const seconds =
      typeof expiresIn === "number"
        ? expiresIn
        : typeof expiresIn === "string" && expiresIn.trim() !== ""
          ? Number(expiresIn)
          : Number.NaN;

    store.cache =
      Number.isFinite(seconds) && seconds > 0
        ? { access_token: accessToken, expires_at: issuedAt + seconds }
        : undefined;
  };

  const getTokenFromCache = () => {
    if (
      store.cache &&
      store.cache.expires_at - gracePeriod > dateTimeProvider.now().unix()
    ) {
      return store.cache.access_token;
    }
  };

  if ("oauth2" in options) {
    const { url, clientId, clientSecret } = options.oauth2;

    const token = async () => {
      const tokenFromCache = getTokenFromCache();
      if (tokenFromCache) {
        return tokenFromCache;
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });
      } catch (error) {
        throw new AlephaError(
          `Failed to fetch access token from ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Check HTTP status
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errorBody = await response.text();
          errorMessage += `: ${errorBody}`;
        } catch {
          // Ignore error reading body
        }
        throw new AlephaError(`Failed to fetch access token: ${errorMessage}`);
      }

      // Parse JSON response
      let json: any;
      try {
        json = await response.json();
      } catch (error) {
        throw new AlephaError(
          `Failed to parse access token response as JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Validate response structure
      if (!json.access_token || !json.expires_in) {
        throw new AlephaError(
          `Invalid access token response: missing access_token or expires_in. Response: ${JSON.stringify(json)}`,
        );
      }

      // An OAuth2 response carries no issue time this process can rely on
      // (a provider that sends one picks its own unit): the clock here is it.
      cacheToken(json.access_token, json.expires_in);

      return json.access_token;
    };

    return {
      token,
    };
  }

  return {
    token: async () => {
      const tokenFromCache = getTokenFromCache();
      if (tokenFromCache) {
        return tokenFromCache;
      }

      const token = await options.issuer.createToken(options.user);

      cacheToken(token.access_token, token.expires_in, token.issued_at);

      return token.access_token;
    },
  };
};

export type ServiceAccountPrimitiveOptions = {
  gracePeriod?: number; // Grace period in seconds before token expiration
} & (
  | {
      oauth2: Oauth2ServiceAccountPrimitiveOptions;
    }
  | {
      issuer: IssuerPrimitive;
      user: UserAccount;
    }
);

export interface Oauth2ServiceAccountPrimitiveOptions {
  /**
   * Get Token URL.
   */
  url: string;

  /**
   * Client ID.
   */
  clientId: string;

  /**
   * Client Secret.
   */
  clientSecret: string;
}

export interface ServiceAccountPrimitive {
  token: () => Promise<string>;
}
