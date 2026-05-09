import { $context, createMiddleware, type Middleware } from "alepha";
import { ForbiddenError } from "alepha/server";
import { UsageService } from "../services/UsageService.ts";

/**
 * Middleware that enforces a per-organization usage limit for a resource.
 *
 * Resolves the organization from `args[0].user.organization`, increments the
 * usage counter for the given resource, and throws `ForbiddenError` if the
 * plan limit has been reached.
 * Throws `ForbiddenError` if no organization is present or the limit is exceeded.
 *
 * ```typescript
 * class ApiController {
 *   search = $action({
 *     use: [$requireLimit("api_calls")],
 *     handler: async ({ query }) => { ... },
 *   });
 * }
 * ```
 *
 * @param resource The resource identifier to track (e.g., "api_calls", "exports").
 */
export const $requireLimit = (resource: string): Middleware => {
  const { alepha } = $context();
  const usageService = alepha.inject(UsageService);

  return createMiddleware({
    name: "$requireLimit",
    options: { resource } as Record<string, unknown>,
    handler: ({ next }) => {
      return async (...args: any[]) => {
        const user = args[0]?.user;
        if (!user?.organization) {
          throw new ForbiddenError("Organization required");
        }
        const result = await usageService.increment(
          user.organization,
          resource,
        );
        if (!result.allowed) {
          throw new ForbiddenError(
            `Usage limit for '${resource}' has been reached (${result.current}/${result.limit})`,
          );
        }
        return next(...args);
      };
    },
  });
};
