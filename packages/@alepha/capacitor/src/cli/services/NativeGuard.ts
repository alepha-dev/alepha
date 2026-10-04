import { $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";

import type { CapacitorPlatform } from "../atoms/capacitorOptions.ts";
import { CapacitorProject } from "./CapacitorProject.ts";

/**
 * What must never reach a binary built for anyone but the developer who ran
 * `alepha capacitor dev`.
 *
 * A development run points the WebView at a server (`server.url`) and opens
 * the transport to plain HTTP on the LAN (iOS App Transport Security
 * exceptions, Android cleartext). Both are restored when the run ends; a run
 * that crashed leaves them behind, and a build that shipped them would load
 * its pages from a laptop that no longer exists, or accept cleartext from
 * anyone. The guard reads every place they live:
 *
 * - `server.url` in the generated `capacitor.config.ts` and in each native
 *   project's copied `capacitor.config.json`;
 * - `NSAllowsArbitraryLoads` or `NSExceptionDomains` in `Info.plist`;
 * - `usesCleartextTraffic="true"` in the Android manifest, and cleartext or
 *   user-installed certificate authorities in the `base-config` or a
 *   `domain-config` of `network_security_config.xml`.
 *
 * A `debug-overrides` block is allowed: Android applies it to debuggable
 * builds only, which is how a phone trusts a local development certificate
 * authority without a release ever doing so. A missing native project is not
 * a finding; a present file that cannot be read is.
 */
export class NativeGuard {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly project = $inject(CapacitorProject);

  /**
   * Every development residue found, as one line each naming the file, the
   * problem and the fix.
   */
  public async inspect(
    root: string,
    platforms: CapacitorPlatform[],
  ): Promise<string[]> {
    const findings: string[] = [];

    await this.inspectSourceConfig(root, findings);

    if (platforms.includes("ios")) {
      await this.inspectCopiedConfig(
        root,
        "ios/App/App/capacitor.config.json",
        findings,
      );
      await this.inspectInfoPlist(root, findings);
    }

    if (platforms.includes("android")) {
      await this.inspectCopiedConfig(
        root,
        "android/app/src/main/assets/capacitor.config.json",
        findings,
      );
      await this.inspectAndroid(root, findings);
    }

    return findings;
  }

  /**
   * Refuse when anything was found.
   *
   * `when` says which moment of the command found it, because the advice
   * differs: before a sync, `alepha capacitor sync` is the recovery; after
   * one, the residue lives in a source file sync does not own.
   */
  public async assertClean(
    root: string,
    platforms: CapacitorPlatform[],
    when: "before sync" | "after sync",
  ): Promise<void> {
    const findings = await this.inspect(root, platforms);
    if (findings.length === 0) {
      return;
    }

    const advice =
      when === "before sync"
        ? "These come from an interrupted `alepha capacitor dev` run. `alepha capacitor sync` rewrites the copied configs; remove the rest by hand, then build again."
        : "They are in files `cap sync` does not rewrite. Remove them by hand, then build again.";

    throw new AlephaError(
      `Refusing to build: development settings would ship in the app (${when}).\n${findings
        .map((finding) => `- ${finding}`)
        .join("\n")}\n${advice}`,
    );
  }

  protected async inspectSourceConfig(
    root: string,
    findings: string[],
  ): Promise<void> {
    const path = this.project.configPath(root);
    if (!(await this.fs.exists(path))) {
      return;
    }
    const content = await this.fs.readTextFile(path);
    if (/\bserver\s*:\s*\{[^}]*\burl\s*:/s.test(content)) {
      findings.push(
        "capacitor.config.ts sets server.url: delete it there and from capacitor({ config }).",
      );
    }
  }

  protected async inspectCopiedConfig(
    root: string,
    relative: string,
    findings: string[],
  ): Promise<void> {
    const path = this.fs.join(root, relative);
    if (!(await this.fs.exists(path))) {
      return;
    }

    let config: { server?: { url?: unknown; cleartext?: unknown } };
    try {
      config = JSON.parse(await this.fs.readTextFile(path));
    } catch {
      throw new AlephaError(
        `${relative} is not valid JSON. Run alepha capacitor sync to rewrite it.`,
      );
    }

    if (config.server?.url !== undefined) {
      findings.push(
        `${relative} points the WebView at ${JSON.stringify(config.server.url)}: run alepha capacitor sync.`,
      );
    }
    if (config.server?.cleartext === true) {
      findings.push(`${relative} allows cleartext: run alepha capacitor sync.`);
    }
  }

  protected async inspectInfoPlist(
    root: string,
    findings: string[],
  ): Promise<void> {
    const path = this.project.infoPlistPath(root);
    if (!(await this.fs.exists(path))) {
      return;
    }
    const plist = await this.fs.readTextFile(path);

    if (/<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/.test(plist)) {
      findings.push(
        "ios/App/App/Info.plist sets NSAllowsArbitraryLoads: remove it from NSAppTransportSecurity.",
      );
    }
    if (plist.includes("<key>NSExceptionDomains</key>")) {
      findings.push(
        "ios/App/App/Info.plist has NSExceptionDomains: remove them from NSAppTransportSecurity.",
      );
    }
  }

  protected async inspectAndroid(
    root: string,
    findings: string[],
  ): Promise<void> {
    const manifestPath = this.project.androidManifestPath(root);
    if (await this.fs.exists(manifestPath)) {
      const manifest = await this.fs.readTextFile(manifestPath);
      if (/android:usesCleartextTraffic\s*=\s*"true"/.test(manifest)) {
        findings.push(
          'android/app/src/main/AndroidManifest.xml sets usesCleartextTraffic="true": remove the attribute.',
        );
      }
    }

    const nscPath = this.fs.join(
      root,
      "android/app/src/main/res/xml/network_security_config.xml",
    );
    if (!(await this.fs.exists(nscPath))) {
      return;
    }

    // Only what applies to a release: `debug-overrides` is cut out first.
    const nsc = (await this.fs.readTextFile(nscPath)).replace(
      /<debug-overrides[\s\S]*?<\/debug-overrides>/g,
      "",
    );
    const file = "android/app/src/main/res/xml/network_security_config.xml";

    if (
      /<(base|domain)-config[^>]*cleartextTrafficPermitted\s*=\s*"true"/.test(
        nsc,
      )
    ) {
      findings.push(
        `${file} permits cleartext outside debug-overrides: remove cleartextTrafficPermitted="true".`,
      );
    }
    if (
      /<(base|domain)-config[\s\S]*?<certificates\s+src\s*=\s*"user"/.test(nsc)
    ) {
      findings.push(
        `${file} trusts user-installed certificate authorities outside debug-overrides: move <certificates src="user"/> into <debug-overrides>.`,
      );
    }
  }
}
