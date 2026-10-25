import { BadRequestError } from "alepha/server";

import type { StackModel } from "../schemas/stackModelSchema.ts";

/**
 * A place a stack can run, and what it accepts.
 */
export interface StackTarget {
  /**
   * Whether the target runs app services (an archive or an image deployed
   * under an app name).
   */
  apps: boolean;
  /**
   * Whether the target runs plain services from their image.
   */
  services: boolean;
  /**
   * Every reason this target refuses the model, each naming the service and
   * what it asked for. Empty when it accepts it.
   */
  refuse(model: StackModel): string[];
}

/**
 * The targets a stack revision is checked against before it is stored.
 *
 * ## Each target declares what it supports, as data
 *
 * Bay runs apps and services and mirrors its own refusals here, so a file
 * that would fail on the machine fails at upload with the same words.
 * Cloudflare (apps only) and Kubernetes are declared now and dispatched to
 * by nothing yet: they exist so the model is checked against more than one
 * target from the start, and a field the model lacks for them shows up as a
 * missing refusal rather than as a redesign.
 *
 * The key is `estates.type`, which is how a stack environment's target is
 * known: the type of the estate it deploys to.
 */
export class StackTargets {
  /**
   * The Compose key each host namespace came from, so Bay's refusal is
   * worded as Bay words it.
   */
  protected static readonly COMPOSE_NAMESPACE_KEYS: Record<string, string> = {
    network: "network_mode",
    pid: "pid",
    ipc: "ipc",
    userns: "userns_mode",
  };

  public readonly targets: Record<string, StackTarget> = {
    bay: {
      apps: true,
      services: true,
      refuse: (model) => {
        const out: string[] = [];
        const apps = new Set(
          model.services.filter((s) => s.kind === "app").map((s) => s.name),
        );
        for (const s of model.services) {
          const say = (message: string) =>
            out.push(`service ${s.name}: ${message}`);
          if (s.fixedName) {
            say(
              "container_name is not allowed: Bay names containers after the stack environment, so staging and production never collide",
            );
          }
          if (s.build) {
            say(
              "build is not allowed: Bay builds nothing on the host; push an image or an archive instead",
            );
          }
          if (s.privileged) {
            say("privileged is not allowed on Bay");
          }
          for (const ns of s.hostNamespaces) {
            say(
              `${StackTargets.COMPOSE_NAMESPACE_KEYS[ns] ?? ns}: host is not allowed on Bay`,
            );
          }
          if (s.kind === "service" && !s.image) {
            say("has no image (and is not an x-lore app)");
          }
          for (const m of s.mounts) {
            if (m.kind === "socket") {
              say(
                "mounting the Docker socket is not allowed: it is root on the host",
              );
            } else if (m.kind === "host") {
              say(
                `bind mount ${m.source} is outside the bundle: only files the bundle carries can be mounted`,
              );
            }
          }
          if (s.kind === "service") {
            for (const dep of s.dependsOn) {
              if (apps.has(dep)) {
                out.push(
                  `service ${s.name} depends on ${dep}, an app service: on Bay services start first and apps after them, so drop that depends_on`,
                );
              }
            }
          }
          if (s.kind === "app" && s.tcp) {
            say(
              "x-lore.tcp is for services Compose runs; an app service is reached over HTTP",
            );
          }
        }
        return out;
      },
    },
    cloudflare: {
      apps: true,
      services: false,
      refuse: (model) =>
        model.services
          .filter((s) => s.kind === "service")
          .map(
            (s) => `service ${s.name}: Cloudflare runs apps only, not images`,
          ),
    },
    kubernetes: {
      apps: true,
      services: true,
      refuse: (model) => {
        const out: string[] = [];
        for (const s of model.services) {
          if (s.privileged) {
            out.push(
              `service ${s.name}: privileged is not allowed on Kubernetes`,
            );
          }
          if (s.hostNamespaces.includes("network")) {
            out.push(
              `service ${s.name}: network_mode host is not allowed on Kubernetes`,
            );
          }
          for (const m of s.mounts) {
            if (m.kind === "host" || m.kind === "socket") {
              out.push(
                `service ${s.name}: host bind mount ${m.source} is not allowed on Kubernetes`,
              );
            }
          }
        }
        return out;
      },
    },
  };

  /**
   * Refuses the model unless every named target accepts it, listing every
   * reason of every target at once, so one upload fixes them all.
   */
  public assert(model: StackModel, targets: string[]): void {
    const problems: string[] = [];
    for (const name of [...new Set(targets)].sort()) {
      const target = this.targets[name];
      if (!target) {
        problems.push(`${name} estates cannot run stacks`);
        continue;
      }
      for (const reason of target.refuse(model)) {
        problems.push(targets.length > 1 ? `${name}: ${reason}` : reason);
      }
    }
    if (problems.length > 0) {
      throw new BadRequestError(
        `The compose file cannot run here:\n  ${problems.join("\n  ")}`,
      );
    }
  }
}
