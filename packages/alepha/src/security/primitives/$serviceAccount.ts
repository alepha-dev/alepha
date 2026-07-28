import { $context, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccount } from "../schemas/userAccountInfoSchema.ts";
import type { AccessTokenResponse, IssuerPrimitive } from "./$issuer.ts";

/**
 * Allow to get an access token for a service account.
 *
 * You have some options to configure the service account:
 * - a OAUTH2 URL using client credentials grant type
 * - a JWT secret shared between the services
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
 *     // or
 *     const response = await this.serviceAccount.fetch("https://api.example.com/data");
 *   }
 * }
 * ```
 */
export const $serviceAccount = (
  options: ServiceAccountPrimitiveOptions,
): ServiceAccountPrimitive => {
  const { alepha } = $context();
  const store: {
    cache?: AccessTokenResponse;
  } = {};
  const dateTimeProvider = alepha.inject(DateTimeProvider);
  const gracePeriod = options.gracePeriod ?? 30;

  const cacheToken = (response: Omit<AccessTokenResponse, "at">) => {
    store.cache = {
      ...response,
      issued_at: dateTimeProvider.now().unix(),
    };
  };

  const getTokenFromCache = () => {
    if (store.cache) {
      const { access_token, expires_in, issued_at } = store.cache;
      if (!expires_in) {
        return access_token;
      }

      const now = dateTimeProvider.now().unix();
      const expires = issued_at + expires_in;

      if (expires - gracePeriod > now) {
        return access_token;
      }
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

      cacheToken(json);

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

      cacheToken({
        ...token,
        issued_at: dateTimeProvider.now().unix(),
      });

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
