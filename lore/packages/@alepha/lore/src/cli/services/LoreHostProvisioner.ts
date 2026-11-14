import type { ProjectController } from "@lore/core/api";
import type { HostController, ProjectHostController } from "@lore/deploy/api";
import { $inject, AlephaError } from "alepha";
import { CommandError } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { isHttpError } from "alepha/server";
import { $client } from "alepha/server/links";

import { LoreClientService } from "./LoreClientService.ts";
import { LoreProjectResolver } from "./LoreProjectResolver.ts";
import { LoreRefusals } from "./LoreRefusals.ts";
import type { HostProvider } from "./providers/HostProvider.ts";

/**
 * What `lore host provision` asks for, after its flags are read.
 */
export interface ProvisionPlan {
  provider: HostProvider;
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
 * `lore host provision` (#Q3166, epic E116): buys a server from a
 * provider, enrols it with Lore through cloud-init, and waits until it is
 * online, so one command answers with a host ready to deploy to.
 *
 * The order is what keeps a server from billing unseen:
 *
 * 1. The provider is checked (its CLI installed and logged in) before
 *    anything is written.
 * 2. The host is created, then its one-time enrolment secret (#Q3165).
 * 3. The server is created with a cloud-init running `install.sh` with that
 *    secret and the server's own sslip.io base domain.
 * 4. The server is recorded on the host.
 *
 * A failure before 3 deletes the host. A failure after 3 terminates the
 * server, then deletes the host; when the terminate fails too, the host
 * stays and the error names the server and the command that finishes it.
 * Never a billing server Lore has forgotten.
 */
export class LoreHostProvisioner {
  /**
   * Where a provisioned server fetches Bay's installer.
   */
  public static readonly INSTALL_URL = "https://alepha.dev/bay/install.sh";

  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How often the wait reads the host again. A field so a spec can
   * shorten it.
   */
  public pollMillis = 2_000;

  protected readonly hosts = $client<HostController>(this.client.scope());
  protected readonly lending = $client<ProjectHostController>(
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
   * A fresh name no host of the caller already uses.
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
    // A host belongs to a project since #E126: there is no host
    // without a home to create.
    if (!plan.project) {
      throw this.refusal(
        "lore host provision needs --project <slug>: a host belongs to a project.",
      );
    }
    await plan.provider.check();

    // Before any server is bought: an existing project with Apps off is
    // refused, since nobody could manage the host there.
    const project = await this.ensureProject(plan.project, print);
    // A slug is unique in its home project.
    const { items: homed } = project.created
      ? { items: [] as Array<{ slug: string }> }
      : await this.lending.listHomeHosts({
          params: { projectId: project.id },
        });
    const slug =
      plan.name ?? (await this.generateName(new Set(homed.map((e) => e.slug))));
    if (homed.some((host) => host.slug === slug)) {
      throw this.refusal(
        `${project.slug} already has a host named ${slug}: pick another --name, or omit it for a generated one.`,
      );
    }

    const host = await this.lending.createProjectHost({
      params: { projectId: project.id },
      body: { slug },
    });

    let server: { serverId: string; publicIp: string } | undefined;
    try {
      if (plan.deployAllowed) {
        await this.hosts.updateHost({
          params: { hostId: host.id },
          body: { deployAllowed: true },
        });
      }
      const enrolment = await this.hosts.createHostEnrolment({
        params: { hostId: host.id },
      });
      const hourlyPrice = await plan.provider.hourlyPrice(plan.type, plan.zone);

      print(
        `Creating a ${plan.type} in ${plan.zone} on ${plan.provider.name} for host ${slug}...`,
      );
      server = await plan.provider.create({
        name: slug,
        type: plan.type,
        zone: plan.zone,
        tags: ["lore", slug],
        userData: (ip) => this.cloudInit(enrolment.secret, this.baseDomain(ip)),
      });

      await this.hosts.recordHostProvision({
        params: { hostId: host.id },
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
      const online = await this.waitOnline(host.id, plan.timeoutSeconds);
      return {
        id: host.id,
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
      await this.undo(host.id, slug, plan, server, error);
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
    // `LORE_ESTATE_SECRET` is Bay wire v1: what Bay's `install.sh` reads,
    // served from alepha.dev at the latest release, so it keeps the word Lore
    // used before #E147.
    const env = [
      `LORE_URL=${this.client.hostname()}`,
      `LORE_ESTATE_SECRET=${enrolment}`,
      `BAY_BASE_DOMAIN=${baseDomain}`,
    ].join(" ");
    return [
      "#cloud-config",
      "runcmd:",
      `  - [sh, -c, "curl -sSL ${LoreHostProvisioner.INSTALL_URL} | ${env} sh"]`,
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
   * The project the host belongs to, created with Apps on when it does not
   * exist yet. An existing one with Apps off is refused here, before a server
   * is bought (#Q3282): the host could be managed through no page there.
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
      const apps = existing.capabilities?.find((row) => row.key === "apps");
      if (!apps) {
        throw this.refusal(
          `${existing.slug ?? slug} does not have Apps on, so a host could not be managed there. Turn it on first: lore project capability enable apps --option deploy -p ${existing.slug ?? slug}`,
        );
      }
      print(
        `It will belong to your existing project ${existing.slug ?? slug}.`,
      );
      const options = (apps.options ?? {}) as Record<string, unknown>;
      if (options.deploy !== true) {
        print(
          `${existing.slug ?? slug} cannot deploy apps yet: its Apps capability's deploy option is off. Turn it on with: lore project capability enable apps --option deploy -p ${existing.slug ?? slug}`,
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
    hostId: string,
    timeoutSeconds: number,
  ): Promise<boolean> {
    const deadline = this.dateTime.nowMillis() + timeoutSeconds * 1000;
    for (;;) {
      const host = await this.hosts.getHost({ params: { hostId } });
      if (host.online) {
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
   * one, then delete the host. A terminate that fails keeps the host, so
   * the server stays visible, and the error says how to finish.
   */
  protected async undo(
    hostId: string,
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
          `Provisioning ${slug} failed (${reason}), and terminating its server failed too. The host is kept so the server stays visible. Finish with:\n  ${plan.provider.terminateCommand(server.serverId, plan.zone)}\n  lore host delete ${slug} --keep-server --yes`,
        );
      }
    }
    try {
      await this.hosts.deleteHost({ params: { hostId } });
    } catch {
      // The host is harmless without a server; the original error matters.
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
