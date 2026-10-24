import { BadRequestError } from "alepha/server";
import { parse as parseYaml } from "yaml";

import type { StackModel } from "../schemas/stackModelSchema.ts";
import type { StackModelService } from "../schemas/stackModelServiceSchema.ts";

/**
 * Reads a `compose.yml` into the target-neutral {@link StackModel}.
 *
 * ## What it is, and what it is not
 *
 * It reads the file as written, short syntax and long syntax alike, and
 * keeps what every target needs to decide: services, app references, route
 * labels, ports, mounts, dependencies, healthchecks, backup hooks and the
 * variables the file interpolates. It interpolates nothing and never sees a
 * value: the estate does that at deploy, with the sealed variables.
 *
 * It refuses only what makes the file unreadable or the `x-lore` field
 * malformed, with the service and the key, mirroring Bay's own `x-lore`
 * parser so a typo fails at upload, not on the machine. Whether a readable
 * file can RUN somewhere is {@link StackTargets}' question.
 */
export class StackComposeParser {
  /**
   * The compose file names a bundle may carry, in the order Compose looks.
   */
  public static readonly COMPOSE_NAMES = [
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml",
  ];

  protected static readonly X_LORE_KEYS = [
    "app",
    "routes",
    "port",
    "runtime",
    "tcp",
    "backup",
  ];

  protected static readonly ROUTE_LABEL =
    /^(@|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)$/;

  /**
   * `files` lists every path the bundle carries, so a bind mount of a file
   * the bundle lacks is refused here rather than on the machine.
   */
  public parse(text: string, files: string[]): StackModel {
    let raw: unknown;
    try {
      raw = parseYaml(text, { merge: true, maxAliasCount: 100 });
    } catch (error) {
      throw new BadRequestError(
        `The compose file is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const root = this.map(raw);
    const services = this.map(root?.services);
    if (!root || !services || Object.keys(services).length === 0) {
      throw new BadRequestError("The compose file declares no services");
    }

    const problems: string[] = [];
    const bundle = new Set(files.map((f) => this.normalizePath(f)));
    const model: StackModel = {
      version: 1,
      services: [],
      volumes: Object.keys(this.map(root.volumes) ?? {}).sort(),
      variables: this.variables(text),
    };
    for (const name of Object.keys(services).sort()) {
      const svc = this.map(services[name]) ?? {};
      model.services.push(
        this.service(name, svc, bundle, (message) =>
          problems.push(`service ${name}: ${message}`),
        ),
      );
    }
    if (problems.length > 0) {
      throw new BadRequestError(
        `The compose file cannot be read:\n  ${problems.join("\n  ")}`,
      );
    }
    return model;
  }

  protected service(
    name: string,
    svc: Record<string, unknown>,
    bundle: Set<string>,
    say: (message: string) => void,
  ): StackModelService {
    const lore = this.xLore(this.map(svc["x-lore"]), say);
    const ns: string[] = [];
    for (const [key, label] of [
      ["network_mode", "network"],
      ["pid", "pid"],
      ["ipc", "ipc"],
      ["userns_mode", "userns"],
    ] as const) {
      if (svc[key] === "host") {
        ns.push(label);
      }
    }
    return {
      name,
      kind: lore.app ? "app" : "service",
      app: lore.app,
      image: typeof svc.image === "string" ? svc.image : undefined,
      routes: lore.routes ?? [],
      port: lore.port,
      tcp: lore.tcp,
      ports: this.ports(svc.ports),
      mounts: this.mounts(svc.volumes, bundle, say),
      dependsOn: this.dependsOn(svc.depends_on),
      healthcheck: this.healthcheck(svc.healthcheck),
      environment: this.environment(svc.environment),
      backup: lore.backup,
      runtime: lore.runtime,
      fixedName: "container_name" in svc,
      build: "build" in svc,
      privileged: svc.privileged === true,
      hostNamespaces: ns,
    };
  }

  /**
   * `x-lore`, as Bay's `parseXLore` reads it: unknown keys refused, labels
   * only for routes, `runtime` only on an app.
   */
  protected xLore(
    raw: Record<string, unknown> | undefined,
    say: (message: string) => void,
  ): Pick<StackModelService, "app" | "port" | "tcp" | "runtime" | "backup"> & {
    routes?: string[];
  } {
    const out: Pick<
      StackModelService,
      "app" | "port" | "tcp" | "runtime" | "backup"
    > & { routes?: string[] } = {};
    if (!raw) {
      return out;
    }
    for (const key of Object.keys(raw).sort()) {
      const value = raw[key];
      switch (key) {
        case "app":
          if (typeof value !== "string" || !value) {
            say("x-lore.app must name the app deployed into this service");
          } else {
            out.app = value;
          }
          break;
        case "routes":
          if (!Array.isArray(value)) {
            say('x-lore.routes must be a list of labels, e.g. ["@", "auth"]');
            break;
          }
          out.routes = [];
          for (const item of value) {
            const label = typeof item === "string" ? item : "";
            if (label.includes(".")) {
              say(
                `x-lore.routes: "${label}" is a full domain; the file only names labels ("@", "auth"), full domains are set per environment`,
              );
            } else if (!StackComposeParser.ROUTE_LABEL.test(label)) {
              say(
                `x-lore.routes: "${label}" is not a label: "@" or lowercase letters, digits and hyphens`,
              );
            } else {
              out.routes.push(label);
            }
          }
          break;
        case "port":
        case "tcp":
          if (
            typeof value !== "number" ||
            !Number.isInteger(value) ||
            value < 1 ||
            value > 65535
          ) {
            say(`x-lore.${key} must be a port number`);
          } else {
            out[key] = value;
          }
          break;
        case "runtime":
          if (typeof value !== "string" || !value || /\s/.test(value)) {
            say("x-lore.runtime must be an image reference");
          } else {
            out.runtime = value;
          }
          break;
        case "backup":
          out.backup = this.backup(value, say);
          break;
        default:
          say(
            `x-lore.${key} is not a field Lore knows (${StackComposeParser.X_LORE_KEYS.join(", ")})`,
          );
      }
    }
    if (out.runtime && !out.app) {
      say("x-lore.runtime only applies to an app service (x-lore.app)");
    }
    return out;
  }

  protected backup(
    value: unknown,
    say: (message: string) => void,
  ): StackModelService["backup"] {
    const shape =
      'give {postgres: {user, db}} or {command: "...", restore: "..."}';
    const m = this.map(value);
    if (!m || Object.keys(m).length === 0) {
      say(`x-lore.backup: ${shape}`);
      return undefined;
    }
    const pg = this.map(m.postgres);
    if (pg) {
      if (Object.keys(m).length !== 1) {
        say(`x-lore.backup: postgres takes no other key: ${shape}`);
        return undefined;
      }
      if (
        typeof pg.user !== "string" ||
        !pg.user ||
        typeof pg.db !== "string" ||
        !pg.db
      ) {
        say("x-lore.backup: postgres needs user and db");
        return undefined;
      }
      return { kind: "postgres", user: pg.user, db: pg.db };
    }
    if (typeof m.command !== "string" || !m.command) {
      say(`x-lore.backup: ${shape}`);
      return undefined;
    }
    for (const key of Object.keys(m)) {
      if (key !== "command" && key !== "restore") {
        say(`x-lore.backup: ${key} is not a backup field (command, restore)`);
        return undefined;
      }
    }
    if (
      m.restore !== undefined &&
      (typeof m.restore !== "string" || !m.restore)
    ) {
      say("x-lore.backup: restore must be a command reading the dump on stdin");
      return undefined;
    }
    return {
      kind: "command",
      command: m.command,
      restore: m.restore as string | undefined,
    };
  }

  /**
   * The container ports a service publishes, from `"8080:80"`,
   * `"127.0.0.1:8080:80/tcp"`, `"80"` or `{ target: 80 }`.
   */
  protected ports(raw: unknown): number[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: number[] = [];
    for (const entry of raw) {
      let target: number | undefined;
      if (typeof entry === "number") {
        target = entry;
      } else if (typeof entry === "string") {
        const last = entry.split("/")[0].split(":").pop() ?? "";
        target = Number.parseInt(last.split("-")[0], 10);
      } else {
        const m = this.map(entry);
        target =
          typeof m?.target === "number"
            ? m.target
            : typeof m?.target === "string"
              ? Number.parseInt(m.target, 10)
              : undefined;
      }
      if (target && Number.isInteger(target) && !out.includes(target)) {
        out.push(target);
      }
    }
    return out;
  }

  /**
   * Mounts, short and long syntax. A relative bind is a file of the bundle,
   * and must be one; an absolute bind is the host's; the Docker socket is
   * named apart, since every target refuses it for its own reason.
   */
  protected mounts(
    raw: unknown,
    bundle: Set<string>,
    say: (message: string) => void,
  ): StackModelService["mounts"] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: StackModelService["mounts"] = [];
    for (const entry of raw) {
      let type: string | undefined;
      let source: string | undefined;
      let target: string | undefined;
      if (typeof entry === "string") {
        const parts = entry.split(":");
        if (parts.length === 1) {
          target = parts[0];
        } else {
          source = parts[0];
          target = parts[1];
          type = /^[./~]/.test(source) ? "bind" : "volume";
        }
      } else {
        const m = this.map(entry);
        type = typeof m?.type === "string" ? m.type : undefined;
        source = typeof m?.source === "string" ? m.source : undefined;
        target = typeof m?.target === "string" ? m.target : undefined;
      }
      if (!target) {
        continue;
      }
      if (!source || type === "tmpfs") {
        out.push({ kind: "anonymous", target });
      } else if (type === "volume") {
        out.push({ kind: "volume", source, target });
      } else if (source.endsWith("docker.sock")) {
        out.push({ kind: "socket", source, target });
      } else if (source.startsWith("/") || source.startsWith("~")) {
        out.push({ kind: "host", source, target });
      } else {
        const rel = this.normalizePath(source);
        if (rel === ".." || rel.startsWith("../")) {
          out.push({ kind: "host", source, target });
          continue;
        }
        const present =
          rel === "" ||
          bundle.has(rel) ||
          [...bundle].some((f) => f.startsWith(`${rel}/`));
        if (!present) {
          say(
            `bind mount ./${rel} is not in the bundle: add it next to the compose file`,
          );
        }
        out.push({ kind: "bundle", source: rel, target });
      }
    }
    return out;
  }

  protected dependsOn(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw.filter((d): d is string => typeof d === "string").sort();
    }
    return Object.keys(this.map(raw) ?? {}).sort();
  }

  protected healthcheck(raw: unknown): boolean {
    const m = this.map(raw);
    return !!m && m.disable !== true && m.test !== undefined;
  }

  protected environment(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.split("=")[0])
        .sort();
    }
    return Object.keys(this.map(raw) ?? {}).sort();
  }

  /**
   * Every variable the text interpolates, as Compose reads them: `$$` is an
   * escaped dollar, `${X:-d}` and `${X-d}` have a default, everything else
   * is required.
   */
  protected variables(text: string): StackModel["variables"] {
    const found = new Map<string, boolean>();
    const pattern =
      /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?+][^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
    // YAML comments are not interpolated: an example in a comment is not a
    // variable the deploy must supply.
    const values = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    for (const match of values.matchAll(pattern)) {
      const name = match[1] ?? match[3];
      if (!name) {
        continue;
      }
      const modifier = match[2] ?? "";
      const required = !(
        modifier.startsWith(":-") ||
        modifier.startsWith("-") ||
        modifier.startsWith(":+") ||
        modifier.startsWith("+")
      );
      found.set(name, (found.get(name) ?? false) || required);
    }
    return [...found.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, required]) => ({ name, required }));
  }

  protected normalizePath(path: string): string {
    const parts: string[] = [];
    for (const segment of path.replace(/\\/g, "/").split("/")) {
      if (segment === "" || segment === ".") {
        continue;
      }
      if (
        segment === ".." &&
        parts.length > 0 &&
        parts[parts.length - 1] !== ".."
      ) {
        parts.pop();
      } else {
        parts.push(segment);
      }
    }
    return parts.join("/");
  }

  protected map(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }
}
