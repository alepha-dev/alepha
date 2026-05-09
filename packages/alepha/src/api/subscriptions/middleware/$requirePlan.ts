import { $context, createMiddleware, type Middleware } from "alepha";
import { ForbiddenError } from "alepha/server";
import { SubscriptionService } from "../services/SubscriptionService.ts";

/**
 * Middleware that gates access to a handler behind a subscription feature flag.
 *
 * Resolves the organization from `args[0].user.organization` and checks whether
 * the organization's current plan includes the given feature.
 * Throws `ForbiddenError` if no organization is present or the feature is not available.
 *
 * ```typescript
 * class ReportController {
 *   generate = $action({
 *     use: [$requirePlan("advanced_reports")],
 *     handler: async ({ user }) => { ... },
 *   });
 * }
 * ```
 *
 * @param feature The feature identifier to check against the plan's feature list.
 */
export const $requirePlan = (feature: string): Middleware => {
  const { alepha } = $context();
  const subscriptionService = alepha.inject(SubscriptionService);

  return createMiddleware({
    name: "$requirePlan",
    options: { feature } as Record<string, unknown>,
    handler: ({ next }) => {
      return async (...args: any[]) => {
        const user = args[0]?.user;
        if (!user?.organization) {
          throw new ForbiddenError("Organization required");
        }
        const allowed = await subscriptionService.can(
          user.organization,
          feature,
        );
        if (!allowed) {
          throw new ForbiddenError(
            `Feature '${feature}' not available on your plan`,
          );
        }
        return next(...args);
      };
    },
  });
};
