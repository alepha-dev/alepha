import { $inject } from "alepha";
import { $action, okSchema } from "alepha/server";

import { subscriptionMuteBodySchema } from "../schemas/subscriptionMuteBodySchema.ts";
import { subscriptionPageSchema } from "../schemas/subscriptionPageSchema.ts";
import { subscriptionParamsSchema } from "../schemas/subscriptionParamsSchema.ts";
import { subscriptionProjectParamsSchema } from "../schemas/subscriptionProjectParamsSchema.ts";
import { subscriptionResourceSchema } from "../schemas/subscriptionResourceSchema.ts";
import { subscriptionSetBodySchema } from "../schemas/subscriptionSetBodySchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { SubscriptionService } from "../services/SubscriptionService.ts";

/**
 * Who is told of what in a project (#Q3890). Membership gates every action;
 * `SubscriptionService` decides what each member may do beyond their own
 * rows.
 */
export class SubscriptionController {
  protected readonly subscriptions = $inject(SubscriptionService);
  protected readonly gate = $ownsProject({ param: "projectId" });

  listSubscriptions = $action({
    use: [this.gate],
    method: "GET",
    path: "/projects/:projectId/subscriptions",
    schema: {
      params: subscriptionProjectParamsSchema,
      response: subscriptionPageSchema,
    },
    handler: ({ params, user }) =>
      this.subscriptions.list(params.projectId, user),
  });

  setSubscription = $action({
    use: [this.gate],
    method: "POST",
    path: "/projects/:projectId/subscriptions",
    schema: {
      params: subscriptionProjectParamsSchema,
      body: subscriptionSetBodySchema,
      response: subscriptionResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.subscriptions.set(params.projectId, user, body),
  });

  muteSubscription = $action({
    use: [this.gate],
    method: "POST",
    path: "/projects/:projectId/subscriptions/:id/mute",
    schema: {
      params: subscriptionParamsSchema,
      body: subscriptionMuteBodySchema,
      response: subscriptionResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.subscriptions.mute(params.projectId, params.id, user, body.muted),
  });

  deleteSubscription = $action({
    use: [this.gate],
    method: "DELETE",
    path: "/projects/:projectId/subscriptions/:id",
    schema: {
      params: subscriptionParamsSchema,
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.subscriptions.remove(params.projectId, params.id, user);
      return { ok: true };
    },
  });
}
