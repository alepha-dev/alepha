import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { LoreApiClient } from "./LoreApiClient.ts";

/**
 * One deployed copy, as this client reports it.
 *
 * A hand-written subset of what Lore answers rather than its resource type: the
 * published `.d.ts` must not name the private `lore` workspace. See
 * {@link LoreApiClient} for why that is a build failure rather than a
 * preference.
 */
export interface LoreAppInstance {
  id: string;
  app: string;
  env: string;
  url?: string;
  estateId?: string;
  version?: string;
}

/**
 * One deploy run.
 */
export interface LoreDeployment {
  id: string;
  app: string;
  tag: string;
  status: string;
  url?: string;
  error?: string;
  log: string[];
}

/**
 * What a deploy is about.
 */
export interface LoreDeployInput {
  /**
   * Which app. One of the names the project already uses: there is no app
   * entity, so a typo is silently a different app with no build to ship.
   */
  app: string;
  /**
   * Which copy of it. A free slug - `production`, `b14-staging`, `wassup`.
   */
  env: string;
  /**
   * Which stored build. Defaults to `latest`.
   *
   * ⚠️ `latest` is the ONE tag whose bytes may be replaced in place, so it
   * ships whatever was pushed last rather than a version anybody chose. Name a
   * real tag for anything that has to be reproducible.
   */
  tag?: string;
  /**
   * The project, when it is not the one `LORE_PROJECT` names.
   */
  project?: string;
  /**
   * Create the copy when it does not exist yet.
   *
   * ⚠️ **Off by default, and that is the epic's rule rather than caution.** A
   * missing copy is normally a refusal: minting a deploy target as a side
   * effect of a typo in `env` is how a fleet grows a copy nobody meant to
   * make. Pass `true` where creating one IS the act being performed - a
   * tenant signing up, a preview environment for a branch - because then the
   * caller, not a typo, is what asked for it.
   */
  create?: boolean;
  /**
   * Which estate a newly created copy deploys to, by slug.
   *
   * Only read when {@link create} makes one. Omitted, the new copy inherits
   * the estate of the app's default copy - `production` if it exists, else the
   * first by name - which is what makes "another tenant of this app" a call
   * with no infrastructure in it.
   *
   * ⚠️ It is a SLUG resolved against the estates lent to this project, never
   * an id taken on trust. An estate is owned by a user and lent, and a client
   * that could name an arbitrary one could point a deploy at somebody else's
   * cloud account.
   */
  estate?: string;
}

/**
 * Deploying an app from another server.
 *
 * ## What this is for
 *
 * An app whose environments have a lifecycle of their own: one copy per tenant,
 * per branch, per customer. The static path (`alepha platform up`) cannot
 * express that, because its environments are a list in a committed file. Lore's
 * are rows, and this is the seam that creates one and ships to it.
 *
 * ```ts
 * const lore = alepha.inject(LoreDeployService);
 *
 * const { url } = await lore.deploy({
 *   app: "club",
 *   env: "wassup",
 *   tag: "latest",
 *   create: true,
 * });
 * ```
 *
 * ## ⚠️ Five round trips, and none of them names an estate on the wire
 *
 * Resolve the project, resolve or create the copy, start the run, poll it,
 * read the URL. The destination is read by Lore from the `app_instances` row
 * every time; the only estate this client ever sends is the one
 * {@link LoreDeployInput.estate} names when CREATING a copy, and that goes
 * through Lore's own lending check rather than being trusted.
 *
 * ## ⚠️ What the caller has to have arranged first
 *
 * Neither of these is something this client can do, and both fail with Lore's
 * own words rather than silently:
 *
 * 1. **A build.** `lore apps build` and `lore artifacts push` run in CI, on
 *    the machine holding the source, for the runtime the estate accepts. There
 *    is no build here: Lore's Worker cannot run Vite, and this client is not
 *    where that changes.
 * 2. **An estate lent to the project**, and the `apps.deploy` capability on.
 *    The API key's user needs `app:manage` (to create a copy) and
 *    `deploy:manage` (to ship to one).
 */
export class LoreDeployService {
  protected readonly log = $logger();
  protected readonly api = $inject(LoreApiClient);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The statuses a run stops at, matching `deployments.status`.
   */
  protected static readonly TERMINAL = ["succeeded", "failed", "cancelled"];

  /**
   * How often {@link follow} asks, and how long it waits.
   *
   * ⚠️ The timeout is this CLIENT giving up. The run keeps going server-side,
   * so the error says where to look rather than implying a cancellation.
   */
  public static readonly POLL_INTERVAL_MS = 2_000;
  public static readonly TIMEOUT_MS = 10 * 60 * 1_000;

  /**
   * The whole flow: resolve or create the copy, ship a build to it, wait.
   *
   * Answers the copy's URL when the estate put one into effect. A run that
   * ends anything but `succeeded` throws with the run's own error.
   */
  public async deploy(
    input: LoreDeployInput & { timeoutMs?: number },
  ): Promise<{
    deployment: LoreDeployment;
    instance: LoreAppInstance;
    url?: string;
  }> {
    const projectId = await this.api.projectId(input.project);
    const instance = input.create
      ? await this.ensureInstance(projectId, input)
      : await this.requireInstance(projectId, input);

    const started = await this.start(projectId, instance.id, input.tag);
    const deployment = await this.follow(
      projectId,
      started.id,
      input.timeoutMs,
    );

    if (deployment.status !== "succeeded") {
      throw new AlephaError(
        deployment.error ||
          `Deploying ${input.app}@${input.tag ?? "latest"} to ${input.app}/${input.env} ended ${deployment.status}.`,
      );
    }

    // The URL the adapter put into effect, falling back to what the copy
    // already knew: a redeploy of an unchanged domain answers nothing new.
    const url = deployment.url ?? instance.url;
    this.log.info(`Deployed ${input.app}/${input.env}`, { url });
    return { deployment, instance, url };
  }

  /**
   * The copy a pair names, or nothing.
   */
  public async findInstance(
    projectId: number,
    app: string,
    env: string,
  ): Promise<LoreAppInstance | undefined> {
    try {
      return await this.api.request<LoreAppInstance>(
        "GET",
        `/api/projects/${projectId}/apps/${encodeURIComponent(app)}/${encodeURIComponent(env)}`,
      );
    } catch (error) {
      // ⚠️ Only a 404 is "not there". A revoked key, an unreachable Lore and a
      // 403 are different problems, and reporting them as an absent copy would
      // make `create: true` mint one to paper over an outage.
      if (LoreApiClient.statusOf(error) === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The copy, or a refusal naming where to make one.
   */
  public async requireInstance(
    projectId: number,
    input: LoreDeployInput,
  ): Promise<LoreAppInstance> {
    const found = await this.findInstance(projectId, input.app, input.env);
    if (found) {
      return found;
    }
    throw new AlephaError(
      `${input.app}/${input.env} is not a deployed copy of this project, so there is nowhere to deploy it. Pass \`create: true\` if making one is what you meant, or create it on the project's Apps page.`,
    );
  }

  /**
   * The copy, made if it is missing.
   *
   * ⚠️ Two calls rather than one, because `createApp` takes no estate: the row
   * says a copy exists, and pointing it at an estate is a separate, validated
   * act (`AppService.setEstate` checks the lending, not the estate table).
   */
  public async ensureInstance(
    projectId: number,
    input: LoreDeployInput,
  ): Promise<LoreAppInstance> {
    const found = await this.findInstance(projectId, input.app, input.env);
    if (found) {
      return found;
    }

    const estateId = await this.estateFor(projectId, input);
    const created = await this.api.request<LoreAppInstance>(
      "POST",
      `/api/projects/${projectId}/apps`,
      { app: input.app, env: input.env },
    );

    const linked = await this.api.request<LoreAppInstance>(
      "PATCH",
      `/api/projects/${projectId}/apps/${encodeURIComponent(created.app)}/${encodeURIComponent(created.env)}`,
      { estateId },
    );
    this.log.info(`Created ${linked.app}/${linked.env}`);
    return linked;
  }

  /**
   * Ask Lore to start a run.
   *
   * ⚠️ The body carries a tag and nothing else.
   */
  public async start(
    projectId: number,
    instanceId: string,
    tag?: string,
  ): Promise<{ id: string; status: string }> {
    return await this.api.request<{ id: string; status: string }>(
      "POST",
      `/api/projects/${projectId}/apps/${instanceId}/deployments`,
      { tag: tag ?? "latest" },
    );
  }

  /**
   * Poll one run to a terminal state.
   */
  public async follow(
    projectId: number,
    deploymentId: string,
    timeoutMs = LoreDeployService.TIMEOUT_MS,
  ): Promise<LoreDeployment> {
    const startedAt = this.dateTime.nowMillis();

    for (;;) {
      const row = await this.api.request<{
        id: string;
        app: string;
        tag: string;
        status: string;
        url?: string;
        error?: string;
        log?: Array<{ text: string }>;
      }>("GET", `/api/projects/${projectId}/deployments/${deploymentId}`);

      if (LoreDeployService.TERMINAL.includes(row.status)) {
        return {
          id: row.id,
          app: row.app,
          tag: row.tag,
          status: row.status,
          url: row.url,
          error: row.error,
          log: (row.log ?? []).map((line) => line.text),
        };
      }

      if (this.dateTime.nowMillis() - startedAt > timeoutMs) {
        throw new AlephaError(
          `Stopped following deploy ${deploymentId} after ${Math.round(timeoutMs / 1000)}s. It is still running - read it with the deploy_status tool, or on the copy's Deploy tab.`,
        );
      }

      await this.dateTime.wait(LoreDeployService.POLL_INTERVAL_MS);
    }
  }

  /**
   * Which estate a newly created copy points at.
   *
   * Named by slug, or inherited from the app's default copy. ⚠️ The slug is
   * resolved against the estates LENT to this project, so a name this project
   * does not hold is a refusal rather than a deploy into a stranger's account -
   * and Lore checks the lending again on the write.
   */
  protected async estateFor(
    projectId: number,
    input: LoreDeployInput,
  ): Promise<string> {
    if (input.estate) {
      const lent = await this.api.request<{
        items?: Array<{ id: string; slug: string }>;
      }>("GET", `/api/projects/${projectId}/estates`);
      const found = lent?.items?.find((it) => it.slug === input.estate);
      if (!found) {
        throw new AlephaError(
          `No estate called '${input.estate}' is lent to this project, so ${input.app}/${input.env} cannot be pointed at it.`,
        );
      }
      return found.id;
    }

    const siblings = await this.api.request<{ items?: LoreAppInstance[] }>(
      "GET",
      `/api/projects/${projectId}/apps`,
    );
    const ofApp = (siblings?.items ?? []).filter(
      (it) => it.app === input.app && it.estateId,
    );
    // The same rule `defaultAppInstance` uses server-side: `production` if it
    // exists, else the first env by name. Restated rather than imported for
    // the reason every type here is - it lives in the private workspace.
    const chosen =
      ofApp.find((it) => it.env === "production") ??
      [...ofApp].sort((a, b) => a.env.localeCompare(b.env))[0];

    if (!chosen?.estateId) {
      throw new AlephaError(
        `No copy of ${input.app} names an estate, so a new one has nowhere to inherit from. Pass \`estate\` with the slug of an estate lent to this project, or choose one on an existing copy's Settings tab.`,
      );
    }
    return chosen.estateId;
  }
}
