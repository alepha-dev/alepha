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
   * The host this copy answers on, e.g. `wassup.club.example`.
   *
   * **The same `domain` `alepha.config.ts` declares per environment.** The
   * static path reads it from a committed file and this one reads it from the
   * copy's row, but it lands in the same place: `platformOptions
   * .environments[env].domain`, then the adapter's `custom_domain` route.
   *
   * A bare host: no scheme, no port, no path. It is stored on the copy as an
   * origin so the Apps table renders a working link, and the deploy takes the
   * host back off it.
   *
   * ⚠️ **Omit it and a successful deploy answers no URL.** The Worker is live
   * on `*.workers.dev`, but nothing here can name where: the adapter reports a
   * URL only for a domain it put into effect.
   *
   * ⚠️ **The zone has to be on the estate's own Cloudflare account.** A custom
   * domain is `workers.domains.update` with a zone id, not an arbitrary
   * hostname pointed at a Worker.
   *
   * ⚠️ Only read when this call CREATES the copy. An existing one keeps the
   * address it has, and a domain passed that disagrees with it is logged
   * rather than applied - this client does not re-point a live tenant.
   */
  domain?: string;
  /**
   * Which estate a newly created copy deploys to, **by slug**.
   *
   * Only read when this call creates the copy; an existing one keeps the
   * estate it already has. Empty or omitted takes the estate this project was
   * lent FIRST - see {@link LoreDeployService.estateFor} for why the oldest
   * rather than the newest. A project with none lent is an error.
   *
   * ⚠️ A slug, never an id, and resolved against the estates lent to THIS
   * project. An estate is owned by a user and lent out, so a client that could
   * name an arbitrary one could point a deploy at somebody else's cloud
   * account.
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
 *   domain: "wassup.club.example",
 * });
 * ```
 *
 * ⚠️ **`domain` is the same field `alepha.config.ts` declares per
 * environment**, and it is what makes the answer a URL. The adapter reports one
 * only for a domain it put into effect, so a copy created with no domain
 * deploys perfectly well and answers nothing to link to.
 *
 * ## It ENSURES the copy
 *
 * A copy that does not exist is created, because that is what the caller is
 * doing: a program provisioning a tenant is not a person mistyping `--env`.
 * `lore apps deploy` refuses instead, and the difference is deliberate - a
 * typo on a command line becomes a copy nobody meant, while a slug an
 * application already validated becomes the copy it just promised somebody.
 *
 * ⚠️ **Only a 404 creates.** A revoked key, a 403 or an unreachable Lore
 * rethrows, so an outage cannot turn into a burst of copies nobody asked for.
 *
 * ## ⚠️ Five round trips, and none of them names an estate on the wire
 *
 * Resolve the project, resolve or create the copy, start the run, poll it,
 * read the URL. The destination is read by Lore from the `app_instances` row
 * every time; the only estate this client ever sends is the SLUG
 * {@link LoreDeployInput.estate} names when creating a copy, resolved against
 * the lending rather than trusted.
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
    const instance = await this.ensureInstance(projectId, input);

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
      // make an outage look like a copy to create.
      if (LoreApiClient.statusOf(error) === 404) {
        return undefined;
      }
      throw error;
    }
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
      // ⚠️ Said out loud rather than applied. Re-pointing a live tenant is a
      // config change, not a deploy, and a client that did it silently on
      // every call would move an address somebody set by hand on the Settings
      // tab. Silently ignoring it is the other half of the trap, so it is a
      // log line.
      if (input.domain && found.url !== `https://${input.domain}`) {
        this.log.info(
          `${found.app}/${found.env} already answers on ${found.url ?? "no address"}; the domain passed was not applied`,
          { passed: input.domain },
        );
      }
      return found;
    }

    // ⚠️ Validated before anything is written. A malformed host that reached
    // the row would create a copy whose deploy then fails on Cloudflare's own
    // error, leaving the copy behind.
    const domain =
      input.domain === undefined ? undefined : this.assertDomain(input.domain);
    const estateId = await this.estateFor(projectId, input);
    const created = await this.api.request<LoreAppInstance>(
      "POST",
      `/api/projects/${projectId}/apps`,
      {
        app: input.app,
        env: input.env,
        // Stored as an origin because `app_instances.url` is what the Apps
        // table renders as an `href`; `DeployService` takes the host back off
        // it for the adapter.
        ...(domain === undefined ? {} : { url: `https://${domain}` }),
      },
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
   * A hostname, or a refusal saying what shape one is.
   *
   * Lowercased, because a hostname is case-insensitive and the row would
   * otherwise carry whatever was typed. At least one dot: a deploy target is a
   * name in a zone, so a bare label is a mistake rather than a shorthand.
   */
  protected assertDomain(raw: string): string {
    const domain = raw.trim().toLowerCase();
    const label = "[a-z0-9]([a-z0-9-]*[a-z0-9])?";
    if (!new RegExp(`^${label}(\\.${label})+$`).test(domain)) {
      throw new AlephaError(
        `"${raw}" is not a hostname. Pass the host on its own - \`wassup.club.example\` - with no scheme, no port and no path: it becomes this copy's Cloudflare custom domain, the same \`domain\` an environment declares in alepha.config.ts.`,
      );
    }
    return domain;
  }

  /**
   * Which estate a newly created copy points at.
   *
   * The slug when one is named, and otherwise the estate this project was lent
   * **first**. A project with none lent is an error rather than a copy with
   * nowhere to deploy: that copy would be created, would fail its deploy, and
   * would be left behind for somebody to find.
   *
   * ## ⚠️ The OLDEST lending, not `items[0]`
   *
   * `listProjectEstates` orders by the lending's `createdAt` **descending**, so
   * the first row is the most recently lent. Taking it would mean that lending
   * a second estate silently re-points every new tenant, while the fleet
   * already running stays where it is - a split nothing on any screen would
   * explain. The oldest lending is the one an existing fleet is on, and it does
   * not move when another is added.
   *
   * With exactly one estate lent, which is the ordinary case, every reading of
   * "the first" agrees. The choice only shows up at the moment it would hurt.
   */
  protected async estateFor(
    projectId: number,
    input: LoreDeployInput,
  ): Promise<string> {
    const lent = await this.api.request<{
      items?: Array<{ id: string; slug: string }>;
    }>("GET", `/api/projects/${projectId}/estates`);
    const items = lent?.items ?? [];

    if (items.length === 0) {
      throw new AlephaError(
        `No estate is lent to this project, so ${input.app}/${input.env} would have nowhere to deploy. Lend one on the project's Estates page first.`,
      );
    }

    const named = input.estate?.trim();
    if (!named) {
      // Oldest last, because the list is newest first.
      const oldest = items[items.length - 1];
      if (items.length > 1) {
        this.log.info(
          `Creating ${input.app}/${input.env} on '${oldest.slug}', the first estate lent to this project`,
          { lent: items.map((it) => it.slug) },
        );
      }
      return oldest.id;
    }

    const found = items.find((it) => it.slug === named);
    if (!found) {
      throw new AlephaError(
        `No estate called '${named}' is lent to this project. Lent here: ${items.map((it) => it.slug).join(", ")}.`,
      );
    }
    return found.id;
  }
}
