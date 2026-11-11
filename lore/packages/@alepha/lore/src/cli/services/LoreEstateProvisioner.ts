import type { ProjectController } from "@lore/core/api";
import type {
  EstateController,
  ProjectEstateController,
} from "@lore/deploy/api";
import { $inject, AlephaError } from "alepha";
import { CommandError } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { isHttpError } from "alepha/server";
import { $client } from "alepha/server/links";

import { LoreClientService } from "./LoreClientService.ts";
import { LoreProjectResolver } from "./LoreProjectResolver.ts";
import { LoreRefusals } from "./LoreRefusals.ts";
import type { EstateProvider } from "./providers/EstateProvider.ts";

/**
 * What `lore estate provision` asks for, after its flags are read.
 */
export interface ProvisionPlan {
  provider: EstateProvider;
  name?: string;
  project?: string;
  type: string;
  zone: string;
  deployAllowed: boolean;
  timeoutSeconds: number;
}

/**
 * What a provision produced, for the command to print.
 */
export interface Provisioned {
  id: string;
  slug: string;
  provider: string;
  serverId: string;
  type: string;
  zone: string;
  publicIp: string;
  baseDomain: string;
  hourlyPrice?: number;
  deployAllowed: boolean;
  project?: string;
  projectCreated: boolean;
  online: boolean;
}

/**
 * `lore estate provision` (#Q3166, epic E116): buys a server from a
 * provider, enrols it with Lore through cloud-init, and waits until it is
 * online, so one command answers with an estate ready to deploy to.
 *
 * The order is what keeps a server from billing unseen:
 *
 * 1. The provider is checked (its CLI installed and logged in) before
 *    anything is written.
 * 2. The estate is created, then its one-time enrolment secret (#Q3165).
 * 3. The server is created with a cloud-init running `install.sh` with that
 *    secret and the server's own sslip.io base domain.
 * 4. The server is recorded on the estate.
 *
 * A failure before 3 deletes the estate. A failure after 3 terminates the
 * server, then deletes the estate; when the terminate fails too, the estate
 * stays and the error names the server and the command that finishes it.
 * Never a billing server Lore has forgotten.
 */
export class LoreEstateProvisioner {
  /**
   * Where a provisioned server fetches Bay's installer.
   */
  public static readonly INSTALL_URL = "https://alepha.dev/bay/install.sh";

  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How often the wait reads the estate again. A field so a spec can
   * shorten it.
   */
  public pollMillis = 2_000;

  protected readonly estates = $client<EstateController>(this.client.scope());
  protected readonly lending = $client<ProjectEstateController>(
    this.client.scope(),
  );
  protected readonly projectApi = $client<ProjectController>(
    this.client.scope(),
  );

  /**
   * The words a generated name is made of: two adjectives and a noun,
   * `small-skilled-pie`. Short, lowercase, unambiguous when read aloud.
   */
  protected readonly adjectives = [
    "amber",
    "brave",
    "calm",
    "clever",
    "cosy",
    "crisp",
    "eager",
    "fair",
    "gentle",
    "glad",
    "grand",
    "happy",
    "jolly",
    "keen",
    "kind",
    "lively",
    "lucky",
    "mellow",
    "merry",
    "mild",
    "neat",
    "nimble",
    "noble",
    "plain",
    "proud",
    "quick",
    "quiet",
    "rapid",
    "rosy",
    "shy",
    "skilled",
    "sleek",
    "small",
    "smart",
    "snug",
    "solid",
    "steady",
    "sunny",
    "swift",
    "tidy",
    "vivid",
    "warm",
    "wise",
    "witty",
    "young",
    "zesty",
  ];

  protected readonly nouns = [
    "acorn",
    "anchor",
    "badger",
    "beacon",
    "bridge",
    "brook",
    "cactus",
    "canyon",
    "cedar",
    "cloud",
    "comet",
    "cove",
    "delta",
    "dune",
    "falcon",
    "fern",
    "field",
    "fjord",
    "garden",
    "harbor",
    "heron",
    "island",
    "lagoon",
    "lantern",
    "maple",
    "meadow",
    "mesa",
    "orchard",
    "otter",
    "pebble",
    "pie",
    "pine",
    "pond",
    "prairie",
    "quarry",
    "raven",
    "reef",
    "ridge",
    "river",
    "sparrow",
    "summit",
    "thicket",
    "tulip",
    "valley",
    "willow",
    "wren",
  ];

  /**
   * A fresh name no estate of the caller already uses.
   */
  async generateName(taken: Set<string>): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const name = [
        this.pick(this.adjectives),
        this.pick(this.adjectives),
        this.pick(this.nouns),
      ].join("-");
      if (!taken.has(name)) {
        return name;
      }
    }
    throw new AlephaError(
      "Could not find a free generated name; pass --name <slug>.",
    );
  }

  async provision(
    plan: ProvisionPlan,
    print: (line?: string) => void,
  ): Promise<Provisioned> {
    await plan.provider.check();

    const { items: mine } = await this.estates.listMyEstates();
    const slug =
      plan.name ?? (await this.generateName(new Set(mine.map((e) => e.slug))));
    if (mine.some((estate) => estate.slug === slug)) {
      throw this.refusal(
        `You already own an estate named ${slug}: pick another --name, or omit it for a generated one.`,
      );
    }

    // An estate belongs to a project since #E126: there is no estate
    // without a home to create.
    if (!plan.project) {
      throw this.refusal(
        "lore estate provision needs --project <slug>: an estate belongs to a project.",
      );
    }
    const project = await this.ensureProject(plan.project, print);

    const estate = await this.lending.createProjectEstate({
      params: { projectId: project.id },
      body: { slug },
    });

    let server: { serverId: string; publicIp: string } | undefined;
    try {
      if (plan.deployAllowed) {
        await this.estates.updateEstate({
          params: { estateId: estate.id },
          body: { deployAllowed: true },
        });
      }
      const enrolment = await this.estates.createEstateEnrolment({
        params: { estateId: estate.id },
      });
      const hourlyPrice = await plan.provider.hourlyPrice(plan.type, plan.zone);

      print(
        `Creating a ${plan.type} in ${plan.zone} on ${plan.provider.name} for estate ${slug}...`,
      );
      server = await plan.provider.create({
        name: slug,
        type: plan.type,
        zone: plan.zone,
        tags: ["lore", slug],
        userData: (ip) => this.cloudInit(enrolment.secret, this.baseDomain(ip)),
      });

      await this.estates.recordEstateProvision({
        params: { estateId: estate.id },
        body: {
          provider: plan.provider.name,
          serverId: server.serverId,
          type: plan.type,
          zone: plan.zone,
          ...(hourlyPrice === undefined ? {} : { hourlyPrice }),
        },
      });

      print(
        `Server ${server.serverId} is booting at ${server.publicIp}; waiting for it to enrol (about 3 minutes)...`,
      );
      const online = await this.waitOnline(estate.id, plan.timeoutSeconds);
      return {
        id: estate.id,
        slug,
        provider: plan.provider.name,
        serverId: server.serverId,
        type: plan.type,
        zone: plan.zone,
        publicIp: server.publicIp,
        baseDomain: this.baseDomain(server.publicIp),
        ...(hourlyPrice === undefined ? {} : { hourlyPrice }),
        deployAllowed: plan.deployAllowed,
        ...(project ? { project: project.slug } : {}),
        projectCreated: project?.created ?? false,
        online,
      };
    } catch (error) {
      await this.undo(estate.id, slug, plan, server, error);
      throw error;
    }
  }

  /**
   * The cloud-init a provisioned server runs on first boot: the installer,
   * enrolling with the one-time secret, apps named under the server's own
   * sslip.io domain. Every value is URL-safe text, so the double-quoted YAML
   * string needs no escaping.
   */
  cloudInit(enrolment: string, baseDomain: string): string {
    const env = [
      `LORE_URL=${this.client.hostname()}`,
      `LORE_ESTATE_SECRET=${enrolment}`,
      `BAY_BASE_DOMAIN=${baseDomain}`,
    ].join(" ");
    return [
      "#cloud-config",
      "runcmd:",
      `  - [sh, -c, "curl -sSL ${LoreEstateProvisioner.INSTALL_URL} | ${env} sh"]`,
      "",
    ].join("\n");
  }

  /**
   * `203.0.113.10` is `203-0-113-10.sslip.io`, which resolves to it with no
   * DNS to set up, and for which Bay obtains a certificate on first request.
   */
  baseDomain(ip: string): string {
    return `${ip.replace(/\./g, "-")}.sslip.io`;
  }

  /**
   * The project the estate is lent to, created when it does not exist yet.
   */
  protected async ensureProject(
    slug: string,
    print: (line?: string) => void,
  ): Promise<{ id: number; slug: string; created: boolean }> {
    let existing:
      | Awaited<ReturnType<typeof this.projectApi.getProjectBySlug>>
      | undefined;
    try {
      existing = await this.projectApi.getProjectBySlug({ params: { slug } });
    } catch (error) {
      if (!this.isMissing(error)) {
        throw error;
      }
    }
    if (existing?.id) {
      // Said, because an existing project is a different act from a new one
      // (the walk of #Q3169 lent a server to an old project silently).
      print(`Lending it to your existing project ${existing.slug ?? slug}.`);
      const apps = existing.capabilities?.find((row) => row.key === "apps");
      const options = (apps?.options ?? {}) as Record<string, unknown>;
      if (!apps || options.deploy !== true) {
        print(
          `${existing.slug ?? slug} cannot deploy apps yet: its Apps capability${apps ? "'s deploy option" : ""} is off. Turn it on with: lore project capability enable apps --option deploy -p ${existing.slug ?? slug}`,
        );
      }
      return { id: existing.id, slug: existing.slug ?? slug, created: false };
    }
    const created = await this.projectApi.createProject({
      body: {
        title: slug,
        capabilities: [{ key: "apps", options: { deploy: true } }],
      },
    });
    const createdSlug = created.slug ?? slug;
    print(`Created project ${createdSlug}.`);
    return { id: created.id, slug: createdSlug, created: true };
  }

  /**
   * A project lookup that failed because the project does not exist, as
   * opposed to any other failure, which must not create one.
   */
  protected isMissing(error: unknown): boolean {
    if (isHttpError(error, 404)) {
      return true;
    }
    return (
      error instanceof Error && error.message.startsWith("No Lore project")
    );
  }

  protected async waitOnline(
    estateId: string,
    timeoutSeconds: number,
  ): Promise<boolean> {
    const deadline = this.dateTime.nowMillis() + timeoutSeconds * 1000;
    for (;;) {
      const estate = await this.estates.getEstate({ params: { estateId } });
      if (estate.online) {
        return true;
      }
      if (this.dateTime.nowMillis() >= deadline) {
        return false;
      }
      await this.dateTime.wait(this.pollMillis);
    }
  }

  /**
   * Puts things back after a failure: terminate the server when there is
   * one, then delete the estate. A terminate that fails keeps the estate, so
   * the server stays visible, and the error says how to finish.
   */
  protected async undo(
    estateId: string,
    slug: string,
    plan: ProvisionPlan,
    server: { serverId: string } | undefined,
    cause: unknown,
  ): Promise<void> {
    if (server) {
      try {
        await plan.provider.terminate(server.serverId, plan.zone);
      } catch {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw this.refusal(
          `Provisioning ${slug} failed (${reason}), and terminating its server failed too. The estate is kept so the server stays visible. Finish with:\n  ${plan.provider.terminateCommand(server.serverId, plan.zone)}\n  lore estate delete ${slug} --keep-server --yes`,
        );
      }
    }
    try {
      await this.estates.deleteEstate({ params: { estateId } });
    } catch {
      // The estate is harmless without a server; the original error matters.
    }
  }

  protected pick(words: string[]): string {
    return words[Math.floor(Math.random() * words.length)]!;
  }

  protected refusal(message: string): CommandError {
    return new CommandError(
      { exitCode: LoreRefusals.EXIT_FAILURE },
      { message },
    );
  }
}
