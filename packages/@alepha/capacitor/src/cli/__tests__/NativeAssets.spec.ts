import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import sharp from "sharp";
import { describe, it } from "vitest";

import { AlephaCliCapacitorPlugin } from "../index.ts";
import { NativeAssets } from "../services/NativeAssets.ts";

const ROOT = "/app";
const RES = `${ROOT}/android/app/src/main/res`;
const IOS = `${ROOT}/ios/App/App/Assets.xcassets`;

/**
 * A square PNG with a transparent quarter, so flattening shows.
 */
const png = async (size: number, color: string, height = size) =>
  sharp({
    create: {
      width: size,
      height,
      channels: 4,
      background: color,
    },
  })
    .composite([
      {
        input: {
          create: {
            width: Math.floor(size / 2),
            height: Math.floor(height / 2),
            channels: 4,
            background: "#000000",
          },
        },
        top: 0,
        left: 0,
        // Punches the quarter out: transparent, not painted over.
        blend: "dest-out",
      },
    ])
    .png()
    .toBuffer();

const setup = async () => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with(AlephaCliCapacitorPlugin);
  const fs = alepha.inject(MemoryFileSystemProvider);
  const assets = alepha.inject(NativeAssets);
  return { fs, assets };
};

const read = async (fs: MemoryFileSystemProvider, path: string) =>
  sharp(await fs.readFile(path)).metadata();

describe("NativeAssets", () => {
  it("writes exactly its listed files for both platforms", async ({
    expect,
  }) => {
    const { fs, assets } = await setup();
    await fs.writeFile(`${ROOT}/icon.png`, await png(1024, "#e11d48"));
    fs.writeFileCalls = [];

    const written = await assets.generate(
      ROOT,
      { source: "icon.png", background: "#112233" },
      ["ios", "android"],
    );

    const expected = assets.outputs(["ios", "android"]);
    expect(written.sort()).toEqual([...expected].sort());
    expect(
      fs.writeFileCalls.map((call) => call.path.slice(ROOT.length + 1)).sort(),
    ).toEqual([...expected].sort());
    expect(
      assets.outputs(["android"]).some((it) => it.startsWith("ios/")),
    ).toBe(false);
  });

  it("makes an opaque 1024 px iOS icon and a 2732 px launch image", async ({
    expect,
  }) => {
    const { fs, assets } = await setup();
    await fs.writeFile(`${ROOT}/icon.png`, await png(2048, "#e11d48"));

    await assets.generate(ROOT, { source: "icon.png" }, ["ios"]);

    const icon = await read(fs, `${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`);
    expect([icon.width, icon.height]).toEqual([1024, 1024]);
    expect(icon.hasAlpha).toBe(false);
    expect(icon.channels).toBe(3);
    // The transparent quarter is the background now: white by default.
    const { data } = await sharp(
      await fs.readFile(`${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`),
    )
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);

    const splash = await read(
      fs,
      `${IOS}/Splash.imageset/splash-2732x2732.png`,
    );
    expect([splash.width, splash.height]).toEqual([2732, 2732]);
  });

  it("makes the Android adaptive, legacy and round icons and every splash", async ({
    expect,
  }) => {
    const { fs, assets } = await setup();
    await fs.writeFile(`${ROOT}/icon.png`, await png(1024, "#e11d48"));

    await assets.generate(ROOT, { source: "icon.png", background: "#0f172a" }, [
      "android",
    ]);

    for (const [density, scale] of [
      ["mdpi", 1],
      ["hdpi", 1.5],
      ["xhdpi", 2],
      ["xxhdpi", 3],
      ["xxxhdpi", 4],
    ] as const) {
      const legacy = await read(fs, `${RES}/mipmap-${density}/ic_launcher.png`);
      expect(legacy.width).toBe(48 * scale);
      expect(legacy.hasAlpha).toBe(false);
      const round = await read(
        fs,
        `${RES}/mipmap-${density}/ic_launcher_round.png`,
      );
      expect(round.width).toBe(48 * scale);
      expect(round.hasAlpha).toBe(true);
      const foreground = await read(
        fs,
        `${RES}/mipmap-${density}/ic_launcher_foreground.png`,
      );
      expect(foreground.width).toBe(108 * scale);
      expect(foreground.hasAlpha).toBe(true);
      const port = await read(fs, `${RES}/drawable-port-${density}/splash.png`);
      const land = await read(fs, `${RES}/drawable-land-${density}/splash.png`);
      expect(port.height).toBeGreaterThan(port.width ?? 0);
      expect([land.width, land.height]).toEqual([port.height, port.width]);
    }

    // The round icon's corner is outside the circle.
    const { data } = await sharp(
      await fs.readFile(`${RES}/mipmap-xxxhdpi/ic_launcher_round.png`),
    )
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);

    expect(
      fs.getFileContent(`${RES}/values/ic_launcher_background.xml`),
    ).toContain('<color name="ic_launcher_background">#0F172A</color>');
    expect(
      fs.getFileContent(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`),
    ).toContain("@mipmap/ic_launcher_foreground");
  });

  it("rasterises a small square SVG to the full size", async ({ expect }) => {
    const { fs, assets } = await setup();
    await fs.writeFile(
      `${ROOT}/icon.svg`,
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#e11d48"/></svg>',
    );

    await assets.generate(ROOT, { source: "icon.svg" }, ["ios"]);

    const icon = await read(fs, `${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`);
    expect([icon.width, icon.height]).toEqual([1024, 1024]);
  });

  it("refuses a non-square, an undersized or an unreadable source before any write", async ({
    expect,
  }) => {
    const { fs, assets } = await setup();
    await fs.writeFile(`${ROOT}/wide.png`, await png(1200, "#e11d48", 1024));
    await fs.writeFile(`${ROOT}/small.png`, await png(512, "#e11d48"));
    await fs.writeFile(`${ROOT}/notes.txt`, "not an image");
    fs.writeFileCalls = [];

    await expect(
      assets.generate(ROOT, { source: "wide.png" }, ["ios", "android"]),
    ).rejects.toThrow(/must be square/);
    await expect(
      assets.generate(ROOT, { source: "small.png" }, ["ios", "android"]),
    ).rejects.toThrow(/at least 1024x1024/);
    await expect(
      assets.generate(ROOT, { source: "notes.txt" }, ["ios"]),
    ).rejects.toThrow(/not an image/);
    await expect(
      assets.generate(ROOT, { source: "missing.png" }, ["ios"]),
    ).rejects.toThrow(/does not exist/);
    expect(fs.writeFileCalls).toEqual([]);
  });

  it("leaves byte-identical files after x, then y, then x", async ({
    expect,
  }) => {
    const { fs, assets } = await setup();
    await fs.writeFile(`${ROOT}/x.png`, await png(1024, "#e11d48"));
    await fs.writeFile(`${ROOT}/y.png`, await png(1024, "#2563eb"));
    const platforms = ["ios", "android"] as const;
    const x = { source: "x.png", background: "#ffffff" };
    const y = { source: "y.png", background: "#000000" };
    const snapshot = async () =>
      Promise.all(
        assets
          .outputs([...platforms])
          .map((path) => fs.readFile(`${ROOT}/${path}`)),
      );

    await assets.generate(ROOT, x, [...platforms]);
    const first = await snapshot();
    expect(await assets.generate(ROOT, y, [...platforms])).not.toEqual([]);
    await assets.generate(ROOT, x, [...platforms]);
    const again = await snapshot();

    expect(again.every((buffer, i) => buffer.equals(first[i]))).toBe(true);
    // A run from the same source writes nothing at all.
    expect(await assets.generate(ROOT, x, [...platforms])).toEqual([]);
  });
});
