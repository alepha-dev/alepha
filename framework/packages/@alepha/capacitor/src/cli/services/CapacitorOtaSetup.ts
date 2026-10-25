import { $inject, Alepha, AlephaError } from "alepha";
import { PackageManagerUtils } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { capacitorOptions } from "../atoms/capacitorOptions.ts";
import { CapacitorPackages } from "./CapacitorPackages.ts";
import { CapacitorProject } from "./CapacitorProject.ts";
import { OtaEnvelope } from "./OtaEnvelope.ts";

/**
 * `alepha capacitor init --ota`: wire live updates into an existing app,
 * after `init` made its native projects.
 *
 * Every edit is planned before any is made. A file this command does not
 * recognize (an entry that does not build its container the scaffold's way,
 * a config without one `capacitor({ ... })` call) refuses the whole run with
 * the exact change to make by hand, and nothing is written. A second run
 * finds everything in place and writes nothing; keys are never minted again
 * nor rotated.
 *
 * What it writes, and where each secret lives:
 *
 * - `alepha.config.ts`: `capacitor({ ota: { publicKey: "ota-public.pem" } })`;
 * - `ota-public.pem`: the publisher's PUBLIC key, committed. It goes into
 *   the native config (`publicKey`), where every device reads it;
 * - `.ota/signing-key.pem` (gitignored, mode 0600): the publisher's PRIVATE
 *   key, for `alepha capacitor release` through `OTA_SIGNING_KEY`. Never in
 *   the app, the server or a deployment: move it to the publisher's secret
 *   store (a CI secret), with the API key `OTA_API_KEY`;
 * - `.env.example`: `OTA_DOWNLOAD_SECRET`, the server's own secret for
 *   download links, set per environment, unrelated to the publisher key;
 * - the server entry: `AlephaCapacitorOtaApi` (`@alepha/capacitor/ota-api`);
 * - the browser entry: `AlephaCapacitor`, then `AlephaCapacitorOta`;
 * - the admin, only when the app has one (`AdminRouter` in a module's
 *   services): `OtaAdminRouter` beside it;
 * - the updater plugin, `@capgo/capacitor-updater` 8.52.1, and the native
 *   config through `capacitor.config.ts`. A native project that exists
 *   already is updated (`cap update`), so it links the plugin at once
 *   rather than at the next build.
 *
 * It grants no permission to anyone and creates no API key: an operator
 * registers the app (with `ota-public.pem`), creates the publishing key with
 * the `ota:release` scope, and lists it on the app, in the OTA admin.
 */
export class CapacitorOtaSetup {
  public static readonly UPDATER = "@capgo/capacitor-updater";
  public static readonly UPDATER_VERSION = "8.52.1";
  public static readonly PUBLIC_KEY = "ota-public.pem";
  public static readonly PRIVATE_KEY = ".ota/signing-key.pem";

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly project = $inject(CapacitorProject);
  protected readonly packages = $inject(CapacitorPackages);
  protected readonly envelope = $inject(OtaEnvelope);

  public async run(opts: { root: string; run: RunnerMethod }): Promise<void> {
    const { root, run } = opts;
    const edits = await this.plan(root);

    const installing = !(await this.pm.hasDependency(
      root,
      CapacitorOtaSetup.UPDATER,
    ));
    if (installing) {
      await run(
        await this.pm.getInstallCommand(
          root,
          `${CapacitorOtaSetup.UPDATER}@${CapacitorOtaSetup.UPDATER_VERSION}`,
          false,
        ),
        { alias: "install the live updater", root },
      );
    }

    await run({
      name: "wire live updates",
      handler: async () => {
        for (const edit of edits) {
          await this.fs.mkdir(edit.path.slice(0, edit.path.lastIndexOf("/")), {
            recursive: true,
          });
          await this.fs.writeFile(
            edit.path,
            edit.content,
            edit.mode ? { mode: edit.mode } : undefined,
          );
          this.log.info(`Wrote ${edit.path.slice(root.length + 1)}`);
        }
        const declared = this.alepha.store.get(capacitorOptions);
        if (declared && !declared.ota) {
          this.alepha.store.set(capacitorOptions, {
            ...declared,
            ota: { publicKey: CapacitorOtaSetup.PUBLIC_KEY },
          });
        }
        await this.project.writeConfig(root, this.project.options());
      },
    });

    if (installing) {
      // The native projects init made before the plugin was installed: link
      // it now, or the tree changes under the next build.
      const pm = await this.pm.getPackageManager(root);
      for (const platform of this.project.platforms(this.project.options())) {
        if (await this.fs.exists(this.fs.join(root, platform))) {
          await run(this.packages.cap(pm, `update ${platform}`), {
            alias: `cap update ${platform}`,
            root,
          });
        }
      }
    }

    if (edits.length === 0) {
      this.log.info("Live updates are already wired: nothing to change.");
    }
    this.log.info(
      [
        "Next, once: register the app in the OTA admin (Live updates) with ota-public.pem, create an API key with the ota:release scope and list its id on the app.",
        `To release: OTA_SIGNING_KEY=${CapacitorOtaSetup.PRIVATE_KEY} OTA_API_KEY=<key> alepha capacitor release <platform> --channel production`,
        "On the server: set OTA_DOWNLOAD_SECRET in every environment.",
      ].join("\n"),
    );
  }

  /**
   * Every edit to make, or a refusal naming what to change by hand. Writes
   * nothing.
   */
  public async plan(
    root: string,
  ): Promise<Array<{ path: string; content: string; mode?: number }>> {
    const edits: Array<{ path: string; content: string; mode?: number }> = [];
    const refusals: string[] = [];
    const change = async (
      relative: string,
      transform: (current: string) => string | { refuse: string },
      { optional = false } = {},
    ) => {
      const path = this.fs.join(root, relative);
      if (!(await this.fs.exists(path))) {
        if (!optional) {
          refusals.push(`${relative} does not exist.`);
        }
        return;
      }
      const current = await this.fs.readTextFile(path);
      const next = transform(current);
      if (typeof next === "object") {
        refusals.push(next.refuse);
      } else if (next !== current) {
        edits.push({ path, content: next });
      }
    };

    await change("alepha.config.ts", (current) => this.config(current));
    await change("src/main.server.ts", (current) =>
      this.entry(current, "src/main.server.ts", [
        { name: "AlephaCapacitorOtaApi", from: "@alepha/capacitor/ota-api" },
      ]),
    );
    await change("src/main.browser.ts", (current) =>
      this.entry(current, "src/main.browser.ts", [
        { name: "AlephaCapacitor", from: "@alepha/capacitor" },
        { name: "AlephaCapacitorOta", from: "@alepha/capacitor/ota" },
      ]),
    );

    const admin = await this.adminModule(root);
    if (admin) {
      await change(admin, (current) => this.admin(current, admin));
    } else {
      this.log.info(
        "No admin in this app (no AdminRouter in a module's services): manage live updates through the ota-api actions, or add @alepha/ui's admin and run this again.",
      );
    }

    await change(".gitignore", (current) =>
      this.appendLines(
        current,
        "# @alepha/capacitor: the publisher's private key",
        ["/.ota/"],
      ),
    );
    await change(
      ".env.example",
      (current) =>
        current.includes("OTA_DOWNLOAD_SECRET")
          ? current
          : this.appendLines(
              current,
              "# Signs the server's short-lived live update download links. Set it on the server only.",
              ["OTA_DOWNLOAD_SECRET="],
            ),
      { optional: true },
    );

    if (refusals.length > 0) {
      throw new AlephaError(
        `Nothing was changed: these files are not shaped the way init --ota edits.\n\n${refusals.join("\n\n")}`,
      );
    }

    // Keys last: only minted when the run is going ahead, never twice.
    const publicPath = this.fs.join(root, CapacitorOtaSetup.PUBLIC_KEY);
    const privatePath = this.fs.join(root, CapacitorOtaSetup.PRIVATE_KEY);
    if (!(await this.fs.exists(publicPath))) {
      if (await this.fs.exists(privatePath)) {
        throw new AlephaError(
          `${CapacitorOtaSetup.PRIVATE_KEY} exists without ${CapacitorOtaSetup.PUBLIC_KEY}: restore the public key from git rather than minting a new pair, which devices would refuse.`,
        );
      }
      const pair = this.envelope.generateKeyPair();
      edits.push({ path: publicPath, content: pair.publicKey });
      edits.push({ path: privatePath, content: pair.privateKey, mode: 0o600 });
    }

    return edits;
  }

  /**
   * `ota: { publicKey }` inside the one `capacitor({ ... })` call.
   */
  protected config(current: string): string | { refuse: string } {
    const calls = current.match(/capacitor\(\{/g) ?? [];
    if (calls.length !== 1) {
      return {
        refuse: `alepha.config.ts: expected one capacitor({ ... }) call, found ${calls.length}. Add to it by hand:\n  ota: { publicKey: "${CapacitorOtaSetup.PUBLIC_KEY}" },`,
      };
    }
    const start = current.indexOf("capacitor({");
    if (/\bota\s*:/.test(current.slice(start))) {
      return current;
    }
    const lineEnd = current.indexOf("\n", start);
    const indent = (current.slice(lineEnd + 1).match(/^\s*/) ?? [""])[0];
    return `${current.slice(0, lineEnd + 1)}${indent}ota: { publicKey: "${CapacitorOtaSetup.PUBLIC_KEY}" },\n${current.slice(lineEnd + 1)}`;
  }

  /**
   * Register modules in an entry built the scaffold's way: `Alepha.create()`,
   * `alepha.with(...)` lines, `run(alepha)`. Each goes after the previous
   * one, or after the last `alepha.with` line.
   */
  protected entry(
    current: string,
    file: string,
    modules: Array<{ name: string; from: string }>,
  ): string | { refuse: string } {
    const missing = modules.filter(
      (it) => !new RegExp(`alepha\\.with\\(${it.name}\\)`).test(current),
    );
    if (missing.length === 0) {
      return current;
    }
    if (
      !/=\s*Alepha\.create\(/.test(current) ||
      !/^alepha\.with\(/m.test(current) ||
      !/run\(alepha\)/.test(current)
    ) {
      return {
        refuse: `${file}: not an entry built as const alepha = Alepha.create(); alepha.with(...); run(alepha). Add by hand:\n${missing
          .map((it) => `  import { ${it.name} } from "${it.from}";`)
          .join(
            "\n",
          )}\n${missing.map((it) => `  alepha.with(${it.name});`).join("\n")}`,
      };
    }

    let next = current;
    for (const module of missing) {
      if (
        !new RegExp(
          `import \\{[^}]*\\b${module.name}\\b[^}]*\\} from "${module.from}"`,
        ).test(next)
      ) {
        next = this.addImport(
          next,
          `import { ${module.name} } from "${module.from}";`,
        );
      }
      const index = modules.indexOf(module);
      const previous = index > 0 ? modules[index - 1] : undefined;
      const anchor = previous
        ? next.match(
            new RegExp(`^alepha\\.with\\(${previous.name}\\);\\n`, "m"),
          )
        : [...next.matchAll(/^alepha\.with\([^\n]*\);\n/gm)].at(-1);
      // AlephaCapacitor goes first, before the app's modules: it must
      // register before the one importing AlephaReactAuth.
      if (!previous && module.name === "AlephaCapacitor") {
        const first = next.match(/^alepha\.with\(/m);
        const at = first?.index ?? 0;
        next = `${next.slice(0, at)}alepha.with(${module.name});\n${next.slice(at)}`;
        continue;
      }
      const at = anchor ? (anchor.index ?? 0) + anchor[0].length : next.length;
      next = `${next.slice(0, at)}alepha.with(${module.name});\n${next.slice(at)}`;
    }
    return next;
  }

  /**
   * `OtaAdminRouter` beside `AdminRouter` in the module's services.
   */
  protected admin(current: string, file: string): string | { refuse: string } {
    if (/\bOtaAdminRouter\b/.test(current)) {
      return current;
    }
    const block = current.match(/services:\s*\[[^\]]*\bAdminRouter\b[^\]]*\]/);
    if (!block) {
      return {
        refuse: `${file}: AdminRouter is not listed in a services array. Add OtaAdminRouter from "@alepha/capacitor/ota-admin" beside it by hand.`,
      };
    }
    const updated = block[0].replace(
      /\bAdminRouter\b(,?)/,
      "AdminRouter, OtaAdminRouter$1",
    );
    let next = current.replace(block[0], updated);
    return this.addImport(
      next,
      'import { OtaAdminRouter } from "@alepha/capacitor/ota-admin";',
    );
  }

  /**
   * The source file whose module lists `AdminRouter`, if any.
   */
  protected async adminModule(root: string): Promise<string | undefined> {
    const src = this.fs.join(root, "src");
    if (!(await this.fs.exists(src))) {
      return undefined;
    }
    const files = (await this.fs.ls(src, { recursive: true }))
      .filter((it) => /\.(ts|tsx)$/.test(it) && !/(^|\/)__tests__\//.test(it))
      .sort();
    for (const file of files) {
      const content = await this.fs.readTextFile(this.fs.join(src, file));
      if (/services:\s*\[[^\]]*\bAdminRouter\b/.test(content)) {
        return `src/${file}`;
      }
    }
    return undefined;
  }

  /**
   * A package import, among the file's package imports in alphabetical
   * order (before its relative ones), as the formatter would place it.
   */
  protected addImport(content: string, line: string): string {
    const source = (it: string) => it.match(/from "([^"]+)"/)?.[1] ?? "";
    const imports = [...content.matchAll(/^import [^;]+;\n/gm)];
    const packages = imports.filter((it) => !source(it[0]).startsWith("."));
    const after = packages.findLast((it) => source(it[0]) < source(line));
    const before = packages.find((it) => source(it[0]) > source(line));
    const at = after
      ? (after.index ?? 0) + after[0].length
      : before
        ? (before.index ?? 0)
        : (imports[0]?.index ?? 0);
    return `${content.slice(0, at)}${line}\n${content.slice(at)}`;
  }

  protected appendLines(
    current: string,
    header: string,
    lines: string[],
  ): string {
    const present = new Set(current.split("\n").map((it) => it.trim()));
    const missing = lines.filter((it) => !present.has(it));
    if (missing.length === 0) {
      return current;
    }
    const prefix = current && !current.endsWith("\n") ? "\n" : "";
    return `${current}${prefix}${current ? "\n" : ""}${header}\n${missing.join("\n")}\n`;
  }
}
