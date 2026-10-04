import type { networkInterfaces } from "node:os";

import { Alepha } from "alepha";
import {
  type AppEntry,
  AppEntryProvider,
  type DevServerOptions,
  ViteDevServerProvider,
} from "alepha/cli";
import { CliProvider } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { capacitorOptions } from "../atoms/capacitorOptions.ts";
import { CapacitorCommand } from "../commands/CapacitorCommand.ts";
import { AlephaCliCapacitorPlugin } from "../index.ts";
import { CapacitorDev } from "../services/CapacitorDev.ts";
import { NativeGuard } from "../services/NativeGuard.ts";
import { seedNativeProject } from "./memoryProject.ts";

const ROOT = "/app";
const PLIST = `${ROOT}/ios/App/App/Info.plist`;

/**
 * The dev server, recorded instead of started.
 */
class RecordingDevServer extends ViteDevServerProvider {
  public inits: DevServerOptions[] = [];
  public closed = false;

  public override async init(options: DevServerOptions): Promise<Alepha> {
    this.inits.push(options);
    return {} as Alepha;
  }

  public override async start(): Promise<void> {}

  public override async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeAppEntryProvider extends AppEntryProvider {
  public override async getAppEntry(root: string): Promise<AppEntry> {
    return { root, server: "src/main.server.ts" };
  }
}

/**
 * A Mac with the network interfaces a spec describes, which also keeps what
 * Info.plist said while the app was running.
 */
class TestCapacitorDev extends CapacitorDev {
  public lan: Record<string, string> = { en0: "192.168.1.48" };
  public plistDuringRun?: string;

  protected override hostPlatform(): NodeJS.Platform {
    return "darwin";
  }

  protected override interfaces(): ReturnType<typeof networkInterfaces> {
    const result: ReturnType<typeof networkInterfaces> = {
      lo0: [
        {
          address: "127.0.0.1",
          family: "IPv4",
          internal: true,
          netmask: "255.0.0.0",
          mac: "00:00:00:00:00:00",
          cidr: "127.0.0.1/8",
        },
      ],
    };
    for (const [name, address] of Object.entries(this.lan)) {
      result[name] = [
        {
          address,
          family: "IPv4",
          internal: false,
          netmask: "255.255.255.0",
          mac: "00:00:00:00:00:01",
          cidr: `${address}/24`,
        },
      ];
    }
    return result;
  }

  public keep(root: string, id: string, port: number): () => void {
    return this.keepReverse(root, { id, name: id, virtual: true }, port);
  }

  protected override async runOnDevice(
    ...args: Parameters<CapacitorDev["runOnDevice"]>
  ): Promise<void> {
    this.plistDuringRun = await this.fs.readTextFile(PLIST);
    await super.runOnDevice(...args);
  }
}

const targets = (list: Array<{ id: string; name: string }>) =>
  JSON.stringify(list);

const setup = async (
  list = [{ id: "phone-1", name: "iPhone 15" }],
  platform: "ios" | "android" = "ios",
) => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: ViteDevServerProvider, use: RecordingDevServer })
    .with({ provide: AppEntryProvider, use: FakeAppEntryProvider })
    .with({ provide: CapacitorDev, use: TestCapacitorDev })
    .with(AlephaCliCapacitorPlugin);
  alepha.store.set(capacitorOptions, {
    appId: "dev.alepha.mobile",
    appName: "Mobile",
    scheme: "mobile",
    apiUrl: "https://api.test",
  });
  const fs = alepha.inject(MemoryFileSystemProvider);
  const shell = alepha.inject(MemoryShellProvider);
  await seedNativeProject(fs, ROOT);
  shell.configure({
    outputs: { [`yarn cap run ${platform} --list --json`]: targets(list) },
  });
  const cli = alepha.inject(CliProvider);
  const cmd = alepha.inject(CapacitorCommand);
  return {
    alepha,
    fs,
    shell,
    server: alepha.inject(RecordingDevServer),
    dev: alepha.inject(TestCapacitorDev),
    run: (argv: string) => cli.run(cmd.dev, { argv, root: ROOT }),
  };
};

describe("alepha capacitor dev", () => {
  it("serves the LAN with the shell's public config in dev mode", async ({
    expect,
  }) => {
    const { server, run } = await setup();

    await run("ios");

    const [options] = server.inits;
    expect(options.host).toBe("0.0.0.0");
    expect(options.displayHost).toBe("192.168.1.48");
    expect(
      JSON.parse(options.define?.__ALEPHA_CAPACITOR__ ?? "{}"),
    ).toMatchObject({
      mode: "dev",
      apiUrl: "https://api.test",
      scheme: "mobile",
    });
    expect(server.closed).toBe(true);
  });

  it("lets --api name the API instead of the configured one", async ({
    expect,
  }) => {
    const { server, run } = await setup();

    await run("ios --api http://192.168.1.48:3313");

    expect(
      JSON.parse(server.inits[0].define?.__ALEPHA_CAPACITOR__ ?? "{}").apiUrl,
    ).toBe("http://192.168.1.48:3313");
  });

  it("names the dev server as the API when none is configured", async ({
    expect,
  }) => {
    // The native session is scoped by its API origin: the shell needs one.
    const { alepha, server, run } = await setup();
    alepha.store.set(capacitorOptions, {
      appId: "dev.alepha.mobile",
      appName: "Mobile",
      scheme: "mobile",
    });

    await run("ios");

    expect(
      JSON.parse(server.inits[0].define?.__ALEPHA_CAPACITOR__ ?? "{}").apiUrl,
    ).toBe("http://192.168.1.48:5173");
  });

  it("runs cap run -l on the target, at the LAN host and the dev port", async ({
    expect,
  }) => {
    const { shell, run } = await setup();

    await run("ios");

    expect(
      shell.wasCalled(
        "yarn cap run ios -l --host 192.168.1.48 --port 5173 --target phone-1",
      ),
    ).toBe(true);
  });

  it("uses localhost for a simulator, and changes nothing native", async ({
    expect,
  }) => {
    const { fs, shell, dev, run } = await setup([
      { id: "sim-1", name: "iPhone 17 (simulator)" },
    ]);
    const before = fs.getFileContent(PLIST);

    await run("ios");

    expect(
      shell.wasCalled(
        "yarn cap run ios -l --host localhost --port 5173 --target sim-1",
      ),
    ).toBe(true);
    expect(dev.plistDuringRun).toBe(before);
  });

  it("treats a running Android emulator as virtual, and reverses the dev port while it runs", async ({
    expect,
  }) => {
    // cap lists it among the devices, named after its hardware, and forwards
    // nothing: the emulator's localhost is its own until adb reverses it.
    const { shell, run } = await setup(
      [{ id: "emulator-5554", name: "Google sdk_gphone64_arm64" }],
      "android",
    );

    await run("android");

    const commands = shell.calls.map((call) => call.command);
    const launch = commands.indexOf(
      "yarn cap run android -l --host localhost --port 5173 --target emulator-5554 --forwardPorts 5173:5173",
    );
    const remove = commands.indexOf(
      "adb -s emulator-5554 reverse --remove tcp:5173",
    );
    expect(launch).toBeGreaterThanOrEqual(0);
    expect(remove).toBeGreaterThan(launch);
  });

  it("keeps the emulator's reverse alive while the app runs", async ({
    expect,
  }) => {
    // adb drops every reverse when its connection to the emulator resets.
    const { shell, dev, alepha } = await setup(
      [{ id: "emulator-5554", name: "Google sdk_gphone64_arm64" }],
      "android",
    );
    const dateTime = alepha.inject(DateTimeProvider);
    dateTime.pause();
    const stop = dev.keep("/app", "emulator-5554", 5173);

    await dateTime.travel([11, "seconds"]);
    const reasserted = shell.calls.filter(
      (call) =>
        call.command === "adb -s emulator-5554 reverse tcp:5173 tcp:5173",
    ).length;
    stop();
    await dateTime.travel([20, "seconds"]);

    expect(reasserted).toBeGreaterThanOrEqual(2);
    expect(
      shell.calls.filter(
        (call) =>
          call.command === "adb -s emulator-5554 reverse tcp:5173 tcp:5173",
      ).length,
    ).toBe(reasserted);
  });

  it("allows local networking on an iOS device while it runs, and puts Info.plist back", async ({
    expect,
  }) => {
    const { fs, dev, run } = await setup();
    const before = fs.getFileContent(PLIST);

    await run("ios");

    expect(dev.plistDuringRun).toContain("<key>NSAllowsLocalNetworking</key>");
    expect(fs.getFileContent(PLIST)).toBe(before);
    expect(await fs.exists(`${ROOT}/.capacitor-dev.json`)).toBe(false);
  });

  it("restores the native files when the launch fails", async ({ expect }) => {
    const { fs, shell, run } = await setup();
    const before = fs.getFileContent(PLIST);
    shell.configure({
      errors: {
        "yarn cap run ios -l --host 192.168.1.48 --port 5173 --target phone-1":
          "no device",
      },
    });

    await expect(run("ios")).rejects.toThrow();

    expect(fs.getFileContent(PLIST)).toBe(before);
    expect(await fs.exists(`${ROOT}/.capacitor-dev.json`)).toBe(false);
  });

  it("leaves a journal a build refuses, and --restore puts things back", async ({
    expect,
  }) => {
    // What a crash leaves: the edit and its journal, never restored.
    const { alepha, fs, run } = await setup();
    const before = fs.getFileContent(PLIST) ?? "";
    await fs.writeFile(
      `${ROOT}/.capacitor-dev.json`,
      JSON.stringify({ files: { "ios/App/App/Info.plist": before } }),
    );
    await fs.writeFile(PLIST, before.replace("<dict>", "<dict><!-- dev -->"));

    expect(
      await alepha.inject(NativeGuard).inspect(ROOT, ["ios"]),
    ).toContainEqual(expect.stringContaining("--restore"));

    await run("--restore");

    expect(fs.getFileContent(PLIST)).toBe(before);
    expect(await alepha.inject(NativeGuard).inspect(ROOT, ["ios"])).toEqual([]);
  });

  it("refuses several plausible LAN addresses with the list, and none at all", async ({
    expect,
  }) => {
    const { dev, run } = await setup();
    dev.lan = { en0: "192.168.1.48", utun4: "10.8.0.2" };

    await expect(run("ios")).rejects.toThrow(/10\.8\.0\.2/);

    dev.lan = {};
    await expect(run("ios")).rejects.toThrow(/no LAN address/);
  });

  it("takes --host over its own guess", async ({ expect }) => {
    const { shell, dev, run } = await setup();
    dev.lan = { en0: "192.168.1.48", utun4: "10.8.0.2" };

    await run("ios --host 192.168.1.48");

    expect(
      shell.wasCalledMatching(/cap run ios -l --host 192\.168\.1\.48 /),
    ).toBe(true);
  });

  it("needs --target when several devices are there", async ({ expect }) => {
    const { shell, run } = await setup([
      { id: "phone-1", name: "iPhone 15" },
      { id: "sim-1", name: "iPhone 17 (simulator)" },
    ]);

    await expect(run("ios")).rejects.toThrow(/--target/);
    await expect(run("ios --target nope")).rejects.toThrow(/No ios target/);

    await run("ios --target sim-1");
    expect(shell.wasCalledMatching(/--target sim-1/)).toBe(true);
  });

  it("never writes a build record", async ({ expect }) => {
    const { fs, run } = await setup();

    await run("ios");

    expect(await fs.exists(`${ROOT}/capacitor.builds.json`)).toBe(false);
  });
});
