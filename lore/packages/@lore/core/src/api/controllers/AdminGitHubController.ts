import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { githubAppRotateBodySchema } from "../schemas/githubAppRotateBodySchema.ts";
import { githubAppStatusSchema } from "../schemas/githubAppStatusSchema.ts";
import { githubDeliveryResourceSchema } from "../schemas/githubDeliveryResourceSchema.ts";
import { githubManifestCompleteBodySchema } from "../schemas/githubManifestCompleteBodySchema.ts";
import { githubManifestStartBodySchema } from "../schemas/githubManifestStartBodySchema.ts";
import { githubManifestStartSchema } from "../schemas/githubManifestStartSchema.ts";
import { GitHubAppService } from "../services/GitHubAppService.ts";
import { GitHubDeliveryService } from "../services/GitHubDeliveryService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";

/**
 * Admin > GitHub (#Q4360, epic #E177): the instance's one GitHub App.
 *
 * Reads are `admin:github:read`, the manifest flow, a rotation and a removal
 * `admin:github:update`, the `admin:<thing>:<verb>` shape of the other admin
 * controllers. No read returns a secret, the admin role included.
 */
export class AdminGitHubController {
  protected readonly url = "/admin/github";
  protected readonly group = "admin:github";
  protected readonly apps = $inject(GitHubAppService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly deliveries = $inject(GitHubDeliveryService);

  public readonly getGitHubApp = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:github:read"] })],
    description:
      "The instance's GitHub App: where it comes from, its slug, install link and webhook URL, never a secret",
    schema: { response: githubAppStatusSchema },
    handler: async () => {
      const status = await this.apps.status();
      // An App from the environment has no row to record a ping on: the
      // last signed delivery says GitHub reaches the URL just as well.
      const last = await this.deliveries.lastReceivedAt();
      if (last && (!status.webhookPingAt || last > status.webhookPingAt)) {
        return { ...status, webhookPingAt: last };
      }
      return status;
    },
  });

  public readonly listGitHubDeliveries = $action({
    method: "GET",
    path: `${this.url}/deliveries`,
    group: this.group,
    use: [$secure({ permissions: ["admin:github:read"] })],
    description:
      "The last deliveries GitHub sent: event, repository, outcome and attempts, never the body",
    schema: {
      response: z.object({ items: z.array(githubDeliveryResourceSchema) }),
    },
    handler: async () => ({ items: await this.deliveries.recent(50) }),
  });

  public readonly startGitHubAppManifest = $action({
    method: "POST",
    path: `${this.url}/manifest`,
    group: this.group,
    use: [$secure({ permissions: ["admin:github:update"] })],
    description:
      "Start creating the GitHub App: the manifest and the signed state the browser posts to GitHub",
    schema: {
      body: githubManifestStartBodySchema,
      response: githubManifestStartSchema,
    },
    handler: async ({ body, user }) =>
      await this.apps.startManifest({
        userId: user!.id,
        ...(body.name ? { name: body.name } : {}),
        ...(body.organization ? { organization: body.organization } : {}),
      }),
  });

  public readonly completeGitHubAppManifest = $action({
    method: "POST",
    path: `${this.url}/manifest/complete`,
    group: this.group,
    use: [$secure({ permissions: ["admin:github:update"] })],
    description:
      "Store the App GitHub created, from the one-time code and state GitHub sent back",
    schema: {
      body: githubManifestCompleteBodySchema,
      response: githubAppStatusSchema,
    },
    handler: async ({ body, user }) => {
      const status = await this.apps.completeManifest({
        userId: user!.id,
        code: body.code,
        state: body.state,
      });
      await this.audits.github.logSuccess("create", {
        ...this.audits.actor(user),
        resourceType: "github-app",
        resourceId: status.appId ?? "",
        description: status.slug ?? "",
      });
      return status;
    },
  });

  public readonly rotateGitHubApp = $action({
    method: "PATCH",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:github:update"] })],
    description:
      "Replace the stored App's private key, webhook secret or client secret",
    schema: {
      body: githubAppRotateBodySchema,
      response: githubAppStatusSchema,
    },
    handler: async ({ body, user }) => {
      const status = await this.apps.rotate(body);
      await this.audits.github.logSuccess("rotate", {
        ...this.audits.actor(user),
        severity: "warning",
        resourceType: "github-app",
        resourceId: status.appId ?? "",
        description: status.slug ?? "",
        metadata: {
          privateKey: Boolean(body.privateKey),
          webhookSecret: Boolean(body.webhookSecret),
          clientSecret: Boolean(body.clientSecret),
        },
      });
      return status;
    },
  });

  public readonly removeGitHubApp = $action({
    method: "DELETE",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:github:update"] })],
    description:
      "Forget the stored GitHub App; the App itself stays on GitHub, where its owner deletes it",
    schema: { response: okSchema },
    handler: async ({ user }) => {
      const before = await this.apps.status();
      await this.apps.remove();
      await this.audits.github.logSuccess("remove", {
        ...this.audits.actor(user),
        severity: "warning",
        resourceType: "github-app",
        resourceId: before.appId ?? "",
        description: before.slug ?? "",
      });
      return { ok: true };
    },
  });
}
