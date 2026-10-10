import { lstat } from "node:fs/promises";

import { $inject, Alepha, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import type { OtaReleaseManifest } from "../../ota/protocol/otaReleaseManifestSchema.ts";
import type { CapacitorPlatform } from "../atoms/capacitorOptions.ts";
import { CapacitorProject } from "./CapacitorProject.ts";
import { CapacitorSync } from "./CapacitorSync.ts";
import { NativeBuildRecords } from "./NativeBuildRecords.ts";
import { NativeFingerprint } from "./NativeFingerprint.ts";
import { NativeGuard } from "./NativeGuard.ts";
import { type OtaArchiveFile, OtaArchiveWriter } from "./OtaArchiveWriter.ts";
import { OtaEnvelope } from "./OtaEnvelope.ts";

/**
 * `alepha capacitor release`: the app shell, built, zipped, sealed with the
 * publisher's key and published to the app's own server as a live update.
 *
 * In order, each step refusing before anything is published:
 *
 * 1. the development guard: no `server.url`, no development exception, in
 *    the sources or the native copies, before anything is rebuilt;
 * 2. the exact native builds it may run on: the recorded builds
 *    (`capacitor.builds.json`) of this app, platform and variant whose
 *    fingerprint is the native project's current one. None, and the native
 *    project moved since the last recorded build (a plugin added, a native
 *    file edited): refused, since no shipped binary could run this web layer;
 * 3. the signing key, from `OTA_SIGNING_KEY` (the PEM, or the path of a file
 *    holding it), never from an argument, and its public half must be the
 *    one the binaries carry (`capacitor({ ota: { publicKey } })`);
 * 4. the shell, built into `dist-capacitor/` (the server's `dist/` is never
 *    touched), checked again by the guard, then read file by file: no
 *    symlink, no path outside it, `index.html` at the root, within the
 *    expansion limits;
 * 5. the ZIP, sealed (Capgo v2), and the manifest, written beside the shell
 *    under `ota/<version>-<platform>/`;
 * 6. unless `--dry-run`, the upload to `<ota.url>/ota/bundles` with
 *    `OTA_API_KEY`, retried on a network failure or a 5xx with the same
 *    release id (the server accepts a retry once).
 *
 * The dry run writes exactly what a release would upload, which the OTA
 * admin accepts as an upload: the browser never signs.
 */
export class CapacitorRelease {
  protected static readonly MAX_EXPANDED = 300_000_000;
  protected static readonly MAX_FILES = 20_000;

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly project = $inject(CapacitorProject);
  protected readonly sync = $inject(CapacitorSync);
  protected readonly records = $inject(NativeBuildRecords);
  protected readonly fingerprint = $inject(NativeFingerprint);
  protected readonly guard = $inject(NativeGuard);
  protected readonly envelope = $inject(OtaEnvelope);
  protected readonly writer = $inject(OtaArchiveWriter);

  public async run(opts: {
    root: string;
    run: RunnerMethod;
    platform: CapacitorPlatform;
    channel: string;
    rollout: number;
    dryRun?: boolean;
  }): Promise<{ manifest: OtaReleaseManifest; directory: string }> {
    const { root, platform } = opts;
    const options = this.project.options();
    if (!options.ota) {
      throw new AlephaError(
        "This app ships no updater. Run alepha capacitor init --ota, which declares capacitor({ ota }) and wires the server.",
      );
    }
    if (
      !Number.isInteger(opts.rollout) ||
      opts.rollout < 0 ||
      opts.rollout > 100
    ) {
      throw new AlephaError("--rollout is a whole percentage, 0 to 100.");
    }

    await this.guard.assertClean(root, [platform], "before sync");

    const variant = this.project.variant();
    const { fingerprint } = await this.fingerprint.compute({
      root,
      platform,
      identity: {
        appId: options.appId,
        appName: options.appName,
        scheme: options.scheme,
        variant,
      },
    });
    const recorded = (await this.records.read(root)).filter(
      (it) =>
        it.appId === options.appId &&
        it.platform === platform &&
        it.variant === variant,
    );
    const builds = [
      ...new Set(
        recorded
          .filter((it) => it.fingerprint === fingerprint)
          .map((it) => it.versionBuild),
      ),
    ].sort();
    if (builds.length === 0) {
      throw new AlephaError(
        recorded.length === 0
          ? `No ${platform} build of ${options.appId} is recorded: a live update needs a binary to run in. Build one with alepha capacitor build ${platform}${this.project.hasVariants() ? ` --variant ${variant}` : ""}.`
          : `The ${platform} native project of ${options.appId} changed since its recorded builds (${recorded.map((it) => it.versionBuild).join(", ")}): no binary that shipped could run this web layer. Bump the build number and build again, then release.`,
      );
    }

    const publicKey = await this.project.otaPublicKey(root, options);
    const privateKey = await this.signingKey(root);
    if (
      !publicKey ||
      this.envelope.keyId(this.envelope.publicKeyOf(privateKey)) !==
        this.envelope.keyId(publicKey) ||
      this.envelope.publicKeyOf(privateKey).trim() !== publicKey.trim()
    ) {
      throw new AlephaError(
        "OTA_SIGNING_KEY is not the private half of capacitor({ ota: { publicKey } }): devices would refuse what it seals.",
      );
    }

    const apiUrl = this.project.resolveApiUrl(options);
    const otaUrl = this.project.publicConfig(options, "bundled", apiUrl).ota
      ?.url;
    if (!otaUrl) {
      throw new AlephaError(
        "capacitor({ ota }) needs the origin of the server mounting ota-api: set ota.url, or apiUrl.",
      );
    }

    await this.sync.run({ root, run: opts.run, webOnly: true });
    await this.guard.assertClean(root, [platform], "after sync");

    const files = await this.collect(this.fs.join(root, this.project.webDir()));
    const archive = this.writer.write(files);
    const sealed = this.envelope.seal(archive, privateKey);
    const version = await this.version(root);
    const manifest: OtaReleaseManifest = {
      format: "alepha-ota/1",
      id: crypto.randomUUID(),
      appId: options.appId,
      platform,
      variant,
      channel: opts.channel,
      version,
      builds,
      fingerprint,
      keyId: this.envelope.keyId(publicKey),
      archive: {
        sha256: sealed.archiveSha256,
        size: archive.length,
        expandedSize: files.reduce((sum, it) => sum + it.data.length, 0),
        files: files.length,
      },
      checksum: sealed.checksum,
      sessionKey: sealed.sessionKey,
      ciphertext: {
        sha256: sealed.ciphertextSha256,
        size: sealed.ciphertext.length,
      },
      rollout: opts.rollout,
      createdAt: this.dateTime.nowISOString(),
    };

    const directory = this.fs.join(
      root,
      this.project.distDir(),
      "ota",
      `${version}-${platform}`,
    );
    await this.fs.mkdir(directory, { recursive: true });
    await this.fs.writeFile(
      this.fs.join(directory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await this.fs.writeFile(
      this.fs.join(directory, "bundle.zip"),
      sealed.ciphertext,
    );

    this.log.info(
      [
        `${opts.dryRun ? "Prepared" : "Releasing"} ${options.appId} ${version} for ${platform} (${variant})`,
        `  channel ${opts.channel}, rollout ${opts.rollout}%`,
        `  native builds ${builds.join(", ")} (fingerprint ${fingerprint.slice(0, 12)})`,
        `  ${files.length} files, archive sha256 ${sealed.archiveSha256}`,
        `  ciphertext sha256 ${sealed.ciphertextSha256}, ${sealed.ciphertext.length} bytes`,
        `  key ${manifest.keyId}`,
        `  ${this.fs.join(this.project.distDir(), "ota", `${version}-${platform}`)}/{manifest.json,bundle.zip}`,
      ].join("\n"),
    );

    if (!opts.dryRun) {
      await this.upload(otaUrl, manifest, sealed.ciphertext);
    }
    return { manifest, directory };
  }

  /**
   * Every file of the built shell, refusing a symlink, an escaping path, a
   * missing `index.html`, or a shell past the expansion limits. `CNAME`,
   * which a static build may write, is left out.
   */
  protected async collect(dir: string): Promise<OtaArchiveFile[]> {
    if (!(await this.fs.exists(this.fs.join(dir, "index.html")))) {
      throw new AlephaError(
        `The shell in ${dir} has no index.html at its root.`,
      );
    }
    const entries = (await this.fs.ls(dir, { recursive: true, hidden: true }))
      .map((it) => it.replaceAll("\\", "/"))
      .sort();
    const files: OtaArchiveFile[] = [];
    let expanded = 0;
    for (const entry of entries) {
      if (entry === "CNAME") {
        continue;
      }
      const path = this.fs.join(dir, entry);
      if (await this.isSymlink(path)) {
        throw new AlephaError(`The shell holds a symlink, ${entry}: refused.`);
      }
      const stat = await this.fs.stat(path);
      if (stat.isDirectory) {
        continue;
      }
      if (!stat.isFile) {
        throw new AlephaError(`The shell holds ${entry}, which is not a file.`);
      }
      if (entry.startsWith("/") || entry.split("/").includes("..")) {
        throw new AlephaError(`The shell path ${entry} escapes it.`);
      }
      const data = new Uint8Array(await this.fs.readFile(path));
      expanded += data.length;
      files.push({ path: entry, data });
    }
    if (files.length > CapacitorRelease.MAX_FILES) {
      throw new AlephaError(
        `The shell holds ${files.length} files, over the ${CapacitorRelease.MAX_FILES} a live update may carry.`,
      );
    }
    if (expanded > CapacitorRelease.MAX_EXPANDED) {
      throw new AlephaError(
        `The shell is ${expanded} bytes, over the ${CapacitorRelease.MAX_EXPANDED} a live update may carry.`,
      );
    }
    return files;
  }

  /**
   * Whether a path is a symlink, read without following it. A method so a
   * spec on a memory file system can answer.
   */
  protected async isSymlink(path: string): Promise<boolean> {
    try {
      return (await lstat(path)).isSymbolicLink();
    } catch {
      return false;
    }
  }

  /**
   * The publisher's private key: `OTA_SIGNING_KEY`, the PEM itself or the
   * path of a file holding it. Never logged.
   */
  protected async signingKey(root: string): Promise<string> {
    const value = String(this.alepha.env.OTA_SIGNING_KEY ?? "").trim();
    if (!value) {
      throw new AlephaError(
        "OTA_SIGNING_KEY is not set: the publisher's private key (the PEM, or the path of its file) signs every release. Keep it in the publisher's environment, never in the app or the server.",
      );
    }
    if (value.includes("-----BEGIN")) {
      return value.replaceAll("\\n", "\n");
    }
    const path = value.startsWith("/") ? value : this.fs.join(root, value);
    if (!(await this.fs.exists(path))) {
      throw new AlephaError(
        `OTA_SIGNING_KEY names ${value}, which does not exist.`,
      );
    }
    return this.fs.readTextFile(path);
  }

  /**
   * The bundle version: the app's `package.json` version and a UTC
   * timestamp, unique per release, e.g. `1.4.0-20261010T120000`.
   */
  protected async version(root: string): Promise<string> {
    let base = "0.0.0";
    try {
      const pkg = JSON.parse(
        await this.fs.readTextFile(this.fs.join(root, "package.json")),
      );
      if (
        typeof pkg.version === "string" &&
        /^[0-9A-Za-z.+_-]+$/.test(pkg.version)
      ) {
        base = pkg.version;
      }
    } catch {
      // No version: the timestamp alone tells releases apart.
    }
    const stamp = this.dateTime
      .now()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "");
    return `${base}-${stamp}`;
  }

  /**
   * `POST /ota/bundles`, retried with the same release id on a network
   * failure or a 5xx: the server takes a retry of a release once.
   */
  protected async upload(
    origin: string,
    manifest: OtaReleaseManifest,
    ciphertext: Uint8Array,
  ): Promise<void> {
    const token = String(this.alepha.env.OTA_API_KEY ?? "").trim();
    if (!token) {
      throw new AlephaError(
        "OTA_API_KEY is not set: an API key with ota:release, listed on this app in the OTA admin, publishes. Or run with --dry-run and upload the files from the admin.",
      );
    }
    let last = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      let response: Response;
      try {
        response = await this.post(origin, token, manifest, ciphertext);
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
        this.log.warn(`Upload attempt ${attempt} failed: ${last}`);
        continue;
      }
      if (response.ok) {
        const body = (await response.json()) as { created?: boolean };
        this.log.info(
          body.created
            ? `Published ${manifest.version} to ${manifest.channel} at ${manifest.rollout}%.`
            : `${manifest.version} was already published (a retry).`,
        );
        return;
      }
      const text = await response.text();
      last = `${response.status} ${text}`;
      if (response.status < 500) {
        throw new AlephaError(`The OTA server refused the release: ${last}`);
      }
      this.log.warn(`Upload attempt ${attempt} failed: ${response.status}`);
    }
    throw new AlephaError(
      `The release was not published after 3 attempts (${last}). Run the same command again: a retry of the same files is safe, or upload ${manifest.id} from the admin.`,
    );
  }

  /**
   * One upload request. A method so a spec can answer for the server.
   */
  protected post(
    origin: string,
    token: string,
    manifest: OtaReleaseManifest,
    ciphertext: Uint8Array,
  ): Promise<Response> {
    const form = new FormData();
    form.append(
      "manifest",
      new Blob([JSON.stringify(manifest)], { type: "application/json" }),
      "manifest.json",
    );
    form.append(
      "bundle",
      new Blob([ciphertext.slice().buffer as ArrayBuffer], {
        type: "application/zip",
      }),
      "bundle.zip",
    );
    return fetch(`${origin}/ota/bundles`, {
      method: "POST",
      body: form,
      headers: { authorization: `Bearer ${token}` },
    });
  }
}
