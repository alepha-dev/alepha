import { Alepha } from "alepha";
import { BuildPipeline, type BuildRequest, type BuildResult } from "alepha/cli";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { OtaBundleInspector } from "../../ota-api/services/OtaBundleInspector.ts";
import type { OtaReleaseManifest } from "../../ota/protocol/otaReleaseManifestSchema.ts";
import {
  type CapacitorOptions,
  capacitorOptions,
} from "../atoms/capacitorOptions.ts";
import { CapacitorCommand } from "../commands/CapacitorCommand.ts";
import { AlephaCliCapacitorPlugin } from "../index.ts";
import { CapacitorNativeBuild } from "../services/CapacitorNativeBuild.ts";
import { CapacitorRelease } from "../services/CapacitorRelease.ts";
import { OtaEnvelope } from "../services/OtaEnvelope.ts";
import { seedNativeProject } from "./memoryProject.ts";

const ROOT = "/app";
const envelope = new OtaEnvelope();
// Test-only keys, made per run.
const keys = envelope.generateKeyPair();
const otherKeys = envelope.generateKeyPair();

/**
 * The shell build, writing a small shell where the real one would.
 */
class ShellPipeline extends BuildPipeline {
  public requests: BuildRequest[] = [];
  public fs?: MemoryFileSystemProvider;

  public override async build(request: BuildRequest): Promise<BuildResult> {
    this.requests.push(request);
    const dir = `${ROOT}/${request.output?.dist}/public`;
    await this.fs!.writeFile(
      `${dir}/index.html`,
      "<!doctype html><p>shell</p>",
    );
    await this.fs!.writeFile(`${dir}/assets/app.js`, "console.log('app')");
    await this.fs!.writeFile(`${dir}/CNAME`, "example.surge.sh");
    return { skipped: false };
  }
}

class MacNativeBuild extends CapacitorNativeBuild {
  protected override hostPlatform(): NodeJS.Platform {
    return "darwin";
  }
}

/**
 * The publisher, answering for the server and the symlinks a memory file
 * system cannot hold.
 */
class TestRelease extends CapacitorRelease {
  public readonly symlinks = new Set<string>();
  public readonly answers: Array<number | Error> = [];
  public readonly posts: Array<{
    origin: string;
    token: string;
    manifest: OtaReleaseManifest;
  }> = [];

  protected override async isSymlink(path: string): Promise<boolean> {
    return this.symlinks.has(path);
  }

  protected override async post(
    origin: string,
    token: string,
    manifest: OtaReleaseManifest,
  ): Promise<Response> {
    this.posts.push({ origin, token, manifest });
    const answer = this.answers.shift() ?? 201;
    if (answer instanceof Error) {
      throw answer;
    }
    return new Response(JSON.stringify({ created: answer === 201 }), {
      status: answer,
    });
  }
}

const base: CapacitorOptions = {
  appId: "dev.alepha.mobile",
  appName: "Mobile",
  scheme: "mobile",
  apiUrl: "https://api.test",
  ota: { publicKey: keys.publicKey },
};

const setup = async (
  opts: { env?: Record<string, string>; options?: CapacitorOptions } = {},
) => {
  const alepha = Alepha.create({
    env: {
      OTA_SIGNING_KEY: keys.privateKey,
      OTA_API_KEY: "ak_test_publisher",
      ...opts.env,
    },
  })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: BuildPipeline, use: ShellPipeline })
    .with({ provide: CapacitorNativeBuild, use: MacNativeBuild })
    .with({ provide: CapacitorRelease, use: TestRelease })
    .with(AlephaCliCapacitorPlugin);
  alepha.store.set(capacitorOptions, opts.options ?? base);

  const fs = alepha.inject(MemoryFileSystemProvider);
  alepha.inject(ShellPipeline).fs = fs;
  const cli = alepha.inject(CliProvider);
  const cmd = alepha.inject(CapacitorCommand);
  await seedNativeProject(fs, ROOT);
  await fs.writeFile(
    `${ROOT}/android/app/build/outputs/apk/debug/app-debug.apk`,
    "apk bytes",
  );

  return {
    alepha,
    fs,
    cmd,
    publisher: alepha.inject(TestRelease),
    build: (argv: string) => cli.run(cmd.build, { argv, root: ROOT }),
    release: (argv: string) => cli.run(cmd.release, { argv, root: ROOT }),
    manifest: async (dist = "dist-capacitor"): Promise<OtaReleaseManifest> => {
      const dirs = await fs.ls(`${ROOT}/${dist}/ota`);
      return JSON.parse(
        await fs.readTextFile(`${ROOT}/${dist}/ota/${dirs[0]}/manifest.json`),
      );
    },
  };
};

describe("alepha capacitor release", () => {
  it("writes the sealed bundle and its manifest on a dry run, for the exact recorded builds", async ({
    expect,
  }) => {
    const { fs, build, release, manifest, publisher } = await setup();
    await build("android");

    await release("android --channel production --dry-run");

    const written = await manifest();
    expect(written).toMatchObject({
      format: "alepha-ota/1",
      appId: "dev.alepha.mobile",
      platform: "android",
      variant: "base",
      channel: "production",
      rollout: 10,
      builds: ["1"],
      keyId: envelope.keyId(keys.publicKey),
    });
    expect(written.version).toMatch(/^0\.0\.0-\d{8}T\d{6}$/);
    expect(publisher.posts).toEqual([]);

    // What a device would open: the shell, CNAME left out.
    const dir = `${ROOT}/dist-capacitor/ota/${written.version}-android`;
    const ciphertext = new Uint8Array(await fs.readFile(`${dir}/bundle.zip`));
    const inspector = new OtaBundleInspector();
    const { archive, archiveSha256 } = await inspector.open({
      ciphertext,
      sessionKey: written.sessionKey,
      checksum: written.checksum,
      publicKey: keys.publicKey,
    });
    expect(archiveSha256).toBe(written.archive.sha256);
    expect(
      await inspector.inspect(archive, { maxFiles: 10, maxExpandedSize: 1e6 }),
    ).toEqual({
      files: 2,
      expandedSize: written.archive.expandedSize,
    });
    expect(written.ciphertext.sha256).toBe(envelope.sha256(ciphertext));
  });

  it("uploads with the API key, retrying a 5xx with the same release id", async ({
    expect,
  }) => {
    const { build, release, publisher } = await setup();
    await build("android");
    publisher.answers.push(503, new Error("socket hang up"), 201);

    await release("android --channel production --rollout 100");

    expect(publisher.posts).toHaveLength(3);
    expect(new Set(publisher.posts.map((it) => it.manifest.id)).size).toBe(1);
    expect(publisher.posts[0]).toMatchObject({
      origin: "https://api.test",
      token: "ak_test_publisher",
    });
    expect(publisher.posts[0].manifest.rollout).toBe(100);
  });

  it("stops at a refusal from the server", async ({ expect }) => {
    const { build, release, publisher } = await setup();
    await build("android");
    publisher.answers.push(403);
    await expect(release("android --channel production")).rejects.toThrow(
      /refused the release: 403/,
    );
    expect(publisher.posts).toHaveLength(1);
  });

  it("refuses with no recorded build, or a native project that moved since", async ({
    expect,
  }) => {
    const { fs, build, release } = await setup();
    await expect(
      release("android --channel production --dry-run"),
    ).rejects.toThrow(/No android build of dev.alepha.mobile is recorded/);

    await build("android");
    // A plugin added, a native file edited: no shipped binary runs it.
    await fs.writeFile(
      `${ROOT}/android/build.gradle`,
      "buildscript { changed }",
    );
    await expect(
      release("android --channel production --dry-run"),
    ).rejects.toThrow(
      /native project of dev.alepha.mobile changed since its recorded builds/,
    );
  });

  it("refuses when server.url would ship", async ({ expect }) => {
    const { fs, build, release } = await setup();
    await build("android");
    await fs.writeFile(
      `${ROOT}/android/app/src/main/assets/capacitor.config.json`,
      JSON.stringify({ server: { url: "http://192.168.1.2:5173" } }),
    );
    await expect(
      release("android --channel production --dry-run"),
    ).rejects.toThrow(/development settings would ship/);
  });

  it("refuses a signing key that is not the binaries' key, or none", async ({
    expect,
  }) => {
    const wrong = await setup({
      env: { OTA_SIGNING_KEY: otherKeys.privateKey },
    });
    await wrong.build("android");
    await expect(
      wrong.release("android --channel production --dry-run"),
    ).rejects.toThrow(/not the private half/);

    const none = await setup({ env: { OTA_SIGNING_KEY: "" } });
    await none.build("android");
    await expect(
      none.release("android --channel production --dry-run"),
    ).rejects.toThrow(/OTA_SIGNING_KEY is not set/);
  });

  it("refuses a rollout outside 0-100 and an app without an updater", async ({
    expect,
  }) => {
    const { build, release } = await setup();
    await build("android");
    await expect(
      release("android --channel production --rollout 101 --dry-run"),
    ).rejects.toThrow(/0 to 100/);

    const plain = await setup({ options: { ...base, ota: undefined } });
    await plain.build("android");
    await expect(
      plain.release("android --channel production --dry-run"),
    ).rejects.toThrow(/ships no updater/);
  });

  it("refuses a symlink in the shell", async ({ expect }) => {
    const { build, release, publisher } = await setup();
    await build("android");
    publisher.symlinks.add(`${ROOT}/dist-capacitor/public/assets/app.js`);
    await expect(
      release("android --channel production --dry-run"),
    ).rejects.toThrow(/symlink, assets\/app\.js/);
  });

  it("names the variant once variants exist, and gates on that variant's builds", async ({
    expect,
  }) => {
    const { build, release, manifest } = await setup({
      options: {
        ...base,
        variants: { acme: { appId: "dev.alepha.acme", scheme: "acme" } },
      },
    });
    await build("android --variant acme");

    await expect(
      release("android --channel production --dry-run"),
    ).rejects.toThrow(/--variant/);
    await expect(
      release("android --channel production --dry-run --variant base"),
    ).rejects.toThrow(/No android build of dev.alepha.mobile is recorded/);

    await release("android --channel production --dry-run --variant acme");
    expect(await manifest("dist-capacitor/acme")).toMatchObject({
      appId: "dev.alepha.acme",
      variant: "acme",
      builds: ["1"],
    });
  });

  it("says what a live update may be used for, in --help", ({ expect }) => {
    const { cmd } = { cmd: new Alepha().inject(CapacitorCommand) };
    expect(cmd.release.options.description).toContain("2.5.2");
  });
});
