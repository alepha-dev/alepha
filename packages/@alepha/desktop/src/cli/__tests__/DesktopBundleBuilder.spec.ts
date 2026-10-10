import { fileURLToPath } from "node:url";

import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { DesktopBundleBuilder } from "../DesktopBundleBuilder.ts";

const packageFile = (path: string) =>
  fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const setup = async () => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider });
  const fs = alepha.inject(MemoryFileSystemProvider);
  const shell = alepha.inject(MemoryShellProvider);
  await fs.writeFile(packageFile("assets/app.icns"), "default-icns");
  await fs.writeFile(packageFile("THIRD_PARTY_NOTICES.md"), "MIT");
  await fs.writeFile("/my project/stage/dist/loom", "executable");
  await fs.writeFile(
    "/my project/package.json",
    JSON.stringify({ version: "2.4.1-rc.3" }),
  );
  await fs.writeFile(
    "/my project/migrations/sqlite/0001/migration.sql",
    "create table x();",
  );
  await fs.writeFile("/my project/assets/icon.png", "png");
  const builder = new DesktopBundleBuilder({ fs, shell });
  return { fs, shell, builder };
};

const input = {
  root: "/my project",
  stage: "/my project/stage",
  binary: "/my project/stage/dist/loom",
  executable: "loom",
  config: { name: "Loom & Co", identifier: "dev.alepha.loom" },
};
const app = "/my project/stage/Loom & Co.app";

describe("DesktopBundleBuilder", () => {
  it("lays out the bundle with the executable, default icon, migrations, notices and plist", async ({
    expect,
  }) => {
    const { fs, builder } = await setup();

    expect(await builder.build(input)).toBe(app);

    expect(fs.files.get(`${app}/Contents/MacOS/loom`)?.toString()).toBe(
      "executable",
    );
    expect(fs.files.get(`${app}/Contents/Resources/app.icns`)?.toString()).toBe(
      "default-icns",
    );
    expect(
      fs.files.has(
        `${app}/Contents/Resources/migrations/sqlite/0001/migration.sql`,
      ),
    ).toBe(true);
    expect(
      fs.files
        .get(`${app}/Contents/Resources/THIRD_PARTY_NOTICES.md`)
        ?.toString(),
    ).toBe("MIT");
    const plist = fs.files.get(`${app}/Contents/Info.plist`)!.toString();
    expect(plist).toContain(
      "<key>CFBundleName</key>\n  <string>Loom &amp; Co</string>",
    );
    expect(plist).toContain(
      "<key>CFBundleExecutable</key>\n  <string>loom</string>",
    );
    expect(plist).toContain(
      "<key>CFBundleIdentifier</key>\n  <string>dev.alepha.loom</string>",
    );
    expect(plist).toContain(
      "<key>CFBundleVersion</key>\n  <string>2.4.1</string>",
    );
    expect(plist).toContain(
      "<key>LSMinimumSystemVersion</key>\n  <string>15.0</string>",
    );
    expect(plist).toContain("<key>NSHighResolutionCapable</key>\n  <true/>");
  });

  it("escapes every XML special character", ({ expect }) => {
    const plist = new DesktopBundleBuilder({} as any).plist(
      { name: `A<b>"c"'d'&e`, identifier: "a.b" },
      "x",
      "1.0",
    );
    expect(plist).toContain(
      "<string>A&lt;b&gt;&quot;c&quot;&apos;d&apos;&amp;e</string>",
    );
    expect(plist).not.toContain("<b>");
  });

  it("converts a configured PNG into every iconset size, then to ICNS, with argv", async ({
    expect,
  }) => {
    const { shell, builder } = await setup();

    await builder.build({
      ...input,
      config: { ...input.config, icon: "assets/icon.png" },
    });

    const sips = shell.calls.filter((call) => call.argv?.[0] === "sips");
    expect(sips).toHaveLength(10);
    expect(sips[0].argv).toEqual([
      "sips",
      "-z",
      "16",
      "16",
      "/my project/assets/icon.png",
      "--out",
      "/my project/stage/app.iconset/icon_16x16.png",
    ]);
    expect(sips[9].argv?.at(-1)).toBe(
      "/my project/stage/app.iconset/icon_512x512@2x.png",
    );
    expect(
      shell.calls.find((call) => call.argv?.[0] === "iconutil")?.argv,
    ).toEqual([
      "iconutil",
      "-c",
      "icns",
      "/my project/stage/app.iconset",
      "-o",
      `${app}/Contents/Resources/app.icns`,
    ]);
  });

  it("signs the executable first, the bundle last, then verifies strictly", async ({
    expect,
  }) => {
    const { shell, builder } = await setup();

    await builder.build(input);

    expect(
      shell.calls
        .filter((call) => call.argv?.[0] === "codesign")
        .map((call) => call.argv),
    ).toEqual([
      [
        "codesign",
        "--force",
        "--sign",
        "-",
        "--timestamp=none",
        `${app}/Contents/MacOS/loom`,
      ],
      ["codesign", "--force", "--sign", "-", "--timestamp=none", app],
      ["codesign", "--verify", "--strict", "--verbose=2", app],
    ]);
  });

  it("fails on a signing or conversion error", async ({ expect }) => {
    const signing = await setup();
    signing.shell.errors.set(
      `codesign --verify --strict --verbose=2 ${app}`,
      "invalid signature",
    );
    await expect(signing.builder.build(input)).rejects.toThrow(
      "invalid signature",
    );

    const icon = await setup();
    icon.shell.errors.set(
      "iconutil -c icns /my project/stage/app.iconset -o /my project/stage/Loom & Co.app/Contents/Resources/app.icns",
      "Invalid Iconset",
    );
    await expect(
      icon.builder.build({
        ...input,
        config: { ...input.config, icon: "assets/icon.png" },
      }),
    ).rejects.toThrow("Invalid Iconset");
  });

  it("refuses an --out naming a bundle", async ({ expect }) => {
    const { builder } = await setup();
    await expect(
      builder.build({ ...input, executable: "loom.app" }),
    ).rejects.toThrow("drop the '.app'");
  });

  it("falls back to 1.0.0 for a version macOS cannot use", async ({
    expect,
  }) => {
    const { fs, builder } = await setup();
    await fs.writeFile(
      "/my project/package.json",
      JSON.stringify({ version: "latest" }),
    );
    expect(await builder.version("/my project")).toBe("1.0.0");
    await fs.rm("/my project/package.json");
    expect(await builder.version("/my project")).toBe("1.0.0");
  });
});
