import { networkInterfaces } from "node:os";

import { $inject, $store, AlephaError } from "alepha";
import {
  AppEntryProvider,
  devOptions,
  PackageManagerUtils,
  ViteDevServerProvider,
} from "alepha/cli";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

import type { CapacitorPlatform } from "../atoms/capacitorOptions.ts";
import { CapacitorPackages } from "./CapacitorPackages.ts";
import { CapacitorProject } from "./CapacitorProject.ts";

/**
 * `alepha capacitor dev <platform>`: the app on a phone or a simulator, served
 * live by the Vite dev server over the network, with hot reload.
 *
 * 1. Picks the target (`--target`, or the only one there is) and the host
 *    the device reaches this machine on: `localhost` for a simulator or an
 *    emulator, the LAN IPv4 for a device. Several plausible LAN addresses (a
 *    VPN, a second network) are refused with the list, rather than guessed;
 *    `--host` settles it.
 * 2. Starts the dev server on `0.0.0.0`, with the shell's public config in
 *    `dev` mode and `--api` (else the configured `apiUrl`, else the dev
 *    server itself) as the API.
 * 3. Runs `cap run <platform> -l --host --port`, which syncs, points the
 *    WebView at the dev server and launches the app, and reverts its own
 *    edits when interrupted.
 * 4. What `cap run -l` does not set, this command sets and restores: an
 *    Android emulator needs `adb reverse` for its `localhost` to be this
 *    machine's, an iOS device loading plain HTTP from the LAN needs
 *    `NSAllowsLocalNetworking`, and an Android app with a network security
 *    config needs cleartext to the dev host allowed there.
 *    The original file is kept in a recovery journal first, restored on exit,
 *    on Ctrl+C and when the launch fails. A crash cannot restore anything;
 *    the next build refuses while the journal exists, and
 *    `alepha capacitor dev --restore` puts the files back.
 *
 * A live-reload binary never records a build: `dev` writes nothing to
 * `capacitor.builds.json`.
 */
export class CapacitorDev {
  public static readonly JOURNAL = ".capacitor-dev.json";

  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly project = $inject(CapacitorProject);
  protected readonly packages = $inject(CapacitorPackages);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly devServer = $inject(ViteDevServerProvider);
  protected readonly dev = $store(devOptions);

  public async run(opts: {
    root: string;
    platform: CapacitorPlatform;
    target?: string;
    host?: string;
    api?: string;
  }): Promise<void> {
    const { root, platform } = opts;
    const options = this.project.options();

    if (platform === "ios" && this.hostPlatform() !== "darwin") {
      throw new AlephaError("An iOS app needs macOS and Xcode to run.");
    }
    if (!(await this.fs.exists(this.project.platformDir(root, platform)))) {
      throw new AlephaError(
        `There is no ${platform}/ project. Run alepha capacitor init first.`,
      );
    }

    if (await this.fs.exists(this.journalPath(root))) {
      this.log.warn("Restoring what an interrupted dev run left behind");
      await this.restore(root);
    }

    const pm = await this.pm.getPackageManager(root);
    const target = await this.selectTarget(root, pm, platform, opts.target);
    const host = opts.host ?? this.selectHost(target);
    const port = this.port();
    const origin = `http://${host}:${port}`;
    const configured = opts.api
      ? this.project.resolveApiUrl({ ...options, apiUrl: opts.api })
      : this.project.resolveApiUrl(options);
    // With no API named, the dev server serves the app's own API: the shell
    // needs its origin all the same, as the scope of the native session.
    const apiUrl = configured ?? origin;
    if (!configured) {
      this.log.warn(`No apiUrl: the app calls the dev server at ${origin}.`);
    } else {
      this.log.info(
        `The API at ${apiUrl} must allow the origin ${origin} (CORS).`,
      );
    }

    const entry = await this.boot.getAppEntry(root);
    await this.devServer.init({
      root,
      entry,
      port,
      host: "0.0.0.0",
      displayHost: host,
      define: this.project.defineFor(
        this.project.publicConfig(options, "dev", apiUrl),
      ),
    });
    await this.devServer.start();

    await this.applyDevExceptions(root, platform, host);
    const reverse = this.reverses(platform, target, host);
    try {
      await this.runOnDevice(root, pm, platform, target, host, port, reverse);
    } finally {
      if (reverse) {
        await this.unreverse(root, target, port);
      }
      await this.restore(root);
      await this.devServer.close();
    }
  }

  /**
   * Put back every file the journal names, then drop the journal.
   */
  public async restore(root: string): Promise<void> {
    const path = this.journalPath(root);
    if (!(await this.fs.exists(path))) {
      return;
    }
    const journal = JSON.parse(await this.fs.readTextFile(path)) as {
      files: Record<string, string>;
    };
    for (const [file, content] of Object.entries(journal.files)) {
      await this.fs.writeFile(this.fs.join(root, file), content);
    }
    await this.fs.rm(path);
  }

  protected journalPath(root: string): string {
    return this.fs.join(root, CapacitorDev.JOURNAL);
  }

  /**
   * The operating system this command runs on.
   */
  protected hostPlatform(): NodeJS.Platform {
    return process.platform;
  }

  /**
   * This machine's network interfaces. A method so a spec can describe
   * another machine.
   */
  protected interfaces(): ReturnType<typeof networkInterfaces> {
    return networkInterfaces();
  }

  protected port(): number {
    if (process.env.SERVER_PORT) {
      return Number(process.env.SERVER_PORT);
    }
    return this.dev?.port ?? 5173;
  }

  /**
   * The device to run on: `--target`, else the only one there is.
   */
  protected async selectTarget(
    root: string,
    pm: "yarn" | "npm" | "pnpm" | "bun",
    platform: CapacitorPlatform,
    wanted?: string,
  ): Promise<DevTarget> {
    const raw = await this.shell.run(
      this.packages.cap(pm, `run ${platform} --list --json`),
      { root, capture: true },
    );
    let targets: Array<{ id: string; name: string }>;
    try {
      targets = JSON.parse(raw.slice(raw.indexOf("[")));
    } catch {
      throw new AlephaError(
        `Could not read the ${platform} targets from cap run --list.`,
      );
    }

    const all = targets.map((target) => ({
      id: target.id,
      name: target.name,
      // The JSON carries no flag: cap suffixes the name of a simulator or an
      // emulator it can boot, and a running Android emulator is listed among
      // the devices under an `emulator-<port>` id.
      virtual:
        /\((simulator|emulator)\)$/.test(target.name) ||
        target.id.startsWith("emulator-"),
    }));

    if (wanted) {
      const found = all.find((target) => target.id === wanted);
      if (!found) {
        throw new AlephaError(
          `No ${platform} target "${wanted}". Available:\n${this.describe(all)}`,
        );
      }
      return found;
    }
    if (all.length === 1) {
      return all[0];
    }
    throw new AlephaError(
      all.length === 0
        ? `No ${platform} device or ${platform === "ios" ? "simulator" : "emulator"} is available.`
        : `Several ${platform} targets are available; name one with --target:\n${this.describe(all)}`,
    );
  }

  protected describe(targets: DevTarget[]): string {
    return targets.map((target) => `  ${target.id}  ${target.name}`).join("\n");
  }

  /**
   * The address the device reaches the dev server on.
   */
  protected selectHost(target: DevTarget): string {
    if (target.virtual) {
      // A simulator shares the Mac's network; an emulator reaches it through
      // the `adb reverse` this command asks for (see reverses).
      return "localhost";
    }

    const candidates = Object.entries(this.interfaces()).flatMap(
      ([name, addresses]) =>
        (addresses ?? [])
          .filter((it) => it.family === "IPv4" && !it.internal)
          .map((it) => ({ name, address: it.address })),
    );
    if (candidates.length === 1) {
      return candidates[0].address;
    }
    throw new AlephaError(
      candidates.length === 0
        ? "This machine has no LAN address a phone could reach. Join the phone's network, or pass --host."
        : `Several network addresses could reach the phone; pass the right one with --host:\n${candidates
            .map((it) => `  ${it.address}  (${it.name})`)
            .join("\n")}`,
    );
  }

  /**
   * An Android emulator's `localhost` is the emulator itself, and `cap run -l`
   * forwards nothing unless asked: with `--forwardPorts`, native-run runs
   * `adb reverse` right before installing, after any adb server restart of
   * its own, so the dev port on the emulator reaches this machine's. The
   * WebView keeps `localhost`, a secure context, where the host alias
   * `10.0.2.2` would be plain HTTP to a remote address.
   */
  protected reverses(
    platform: CapacitorPlatform,
    target: DevTarget,
    host: string,
  ): boolean {
    return platform === "android" && target.virtual && host === "localhost";
  }

  /**
   * native-run keeps the reverse once it exits, which it does as soon as the
   * app is launched: remove it when the dev run ends. Best effort, since the
   * emulator may be gone by then.
   */
  protected async unreverse(
    root: string,
    target: DevTarget,
    port: number,
  ): Promise<void> {
    await this.shell
      .run(
        [
          await this.adb(),
          "-s",
          target.id,
          "reverse",
          "--remove",
          `tcp:${port}`,
        ],
        { root, capture: true },
      )
      .catch(() => undefined);
  }

  /**
   * The adb of the Android SDK, else the one on the PATH.
   */
  protected async adb(): Promise<string> {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    if (sdk) {
      const path = this.fs.join(sdk, "platform-tools", "adb");
      if (await this.fs.exists(path)) {
        return path;
      }
    }
    return "adb";
  }

  /**
   * Set what `cap run -l` leaves to the app: plain HTTP to the dev server.
   * Journaled first.
   */
  protected async applyDevExceptions(
    root: string,
    platform: CapacitorPlatform,
    host: string,
  ): Promise<void> {
    const edit =
      platform === "ios"
        ? await this.iosDevException(root, host)
        : await this.androidDevException(root, host);
    if (!edit) {
      return;
    }

    await this.fs.writeFile(
      this.journalPath(root),
      `${JSON.stringify({ platform, files: { [edit.relative]: edit.before } }, null, 2)}\n`,
    );
    await this.fs.writeFile(this.fs.join(root, edit.relative), edit.after);
  }

  /**
   * An iOS device loading plain HTTP from the LAN needs
   * `NSAllowsLocalNetworking`. A simulator's `localhost` is exempt already.
   */
  protected async iosDevException(
    root: string,
    host: string,
  ): Promise<DevEdit | undefined> {
    if (host === "localhost") {
      return undefined;
    }
    const relative = "ios/App/App/Info.plist";
    const path = this.fs.join(root, relative);
    if (!(await this.fs.exists(path))) {
      return undefined;
    }
    const plist = await this.fs.readTextFile(path);
    if (plist.includes("<key>NSAppTransportSecurity</key>")) {
      this.log.warn(
        "Info.plist already declares NSAppTransportSecurity; not adding the development exception.",
      );
      return undefined;
    }
    return {
      relative,
      before: plist,
      after: plist.replace(
        /\n<\/dict>\s*\n<\/plist>\s*$/,
        (end) =>
          `\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>\n\t</dict>${end}`,
      ),
    };
  }

  /**
   * `cap run -l` allows cleartext through the manifest's
   * `usesCleartextTraffic`, which Android ignores once the app declares a
   * network security config (one that trusts user CAs in `debug-overrides`,
   * say): the WebView then refuses the dev server with
   * `ERR_CLEARTEXT_NOT_PERMITTED`. Allow cleartext to the dev host alone, in
   * that config, for the run.
   */
  protected async androidDevException(
    root: string,
    host: string,
  ): Promise<DevEdit | undefined> {
    const manifestPath = this.fs.join(
      root,
      "android/app/src/main/AndroidManifest.xml",
    );
    if (!(await this.fs.exists(manifestPath))) {
      return undefined;
    }
    const name = (await this.fs.readTextFile(manifestPath)).match(
      /android:networkSecurityConfig="@xml\/([\w.]+)"/,
    )?.[1];
    if (!name) {
      return undefined;
    }
    const relative = `android/app/src/main/res/xml/${name}.xml`;
    const path = this.fs.join(root, relative);
    if (!(await this.fs.exists(path))) {
      return undefined;
    }
    const config = await this.fs.readTextFile(path);
    if (!config.includes("</network-security-config>")) {
      this.log.warn(
        `${relative} has no closing </network-security-config>; not adding the development exception.`,
      );
      return undefined;
    }
    return {
      relative,
      before: config,
      after: config.replace(
        "</network-security-config>",
        `    <domain-config cleartextTrafficPermitted="true">\n        <domain includeSubdomains="false">${host}</domain>\n    </domain-config>\n</network-security-config>`,
      ),
    };
  }

  /**
   * `cap run -l`, until it ends. It syncs first, launches the app and keeps
   * running until interrupted (it then reverts its own edits and exits 0);
   * this process waits for it rather than dying on the same Ctrl+C, so the
   * journal is restored after it. A launch that fails rejects, after the
   * same restore.
   */
  protected async runOnDevice(
    root: string,
    pm: "yarn" | "npm" | "pnpm" | "bun",
    platform: CapacitorPlatform,
    target: DevTarget,
    host: string,
    port: number,
    reverse: boolean,
  ): Promise<void> {
    const forward = reverse ? ` --forwardPorts ${port}:${port}` : "";
    const ignore = () => {};
    process.on("SIGINT", ignore);
    const stopKeeping = reverse
      ? this.keepReverse(root, target, port)
      : () => {};
    try {
      await this.shell.run(
        this.packages.cap(
          pm,
          `run ${platform} -l --host ${host} --port ${port} --target ${target.id}${forward}`,
        ),
        { root },
      );
    } finally {
      stopKeeping();
      process.off("SIGINT", ignore);
    }
  }

  /**
   * Re-assert the emulator's `adb reverse` every few seconds while the app
   * runs. adb drops every reverse when its connection to the emulator
   * resets, which happens on its own during a long session; the WebView
   * then loses the dev server with nothing on screen to say why.
   * Idempotent, and quiet when the emulator is momentarily unreachable.
   *
   * @returns a function that stops it
   */
  protected keepReverse(
    root: string,
    target: DevTarget,
    port: number,
  ): () => void {
    const interval = this.dateTime.createInterval(
      async () => {
        await this.shell
          .run(
            [
              await this.adb(),
              "-s",
              target.id,
              "reverse",
              `tcp:${port}`,
              `tcp:${port}`,
            ],
            { root, capture: true },
          )
          .catch(() => undefined);
      },
      [5, "seconds"],
      true,
    );
    return () => this.dateTime.clearInterval(interval);
  }
}

/**
 * A device or a simulator `cap run` can launch on.
 */
interface DevTarget {
  id: string;
  name: string;
  virtual: boolean;
}

/**
 * One native file a dev run changes: its path from the app root, what it
 * held, what the run needs it to hold.
 */
interface DevEdit {
  relative: string;
  before: string;
  after: string;
}
