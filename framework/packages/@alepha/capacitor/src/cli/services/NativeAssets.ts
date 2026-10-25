import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import type { CapacitorPlatform } from "../atoms/capacitorOptions.ts";
import type { CapacitorIcon } from "../schemas/capacitorIconSchema.ts";

/**
 * The icons and the splash of both native projects, from one square source
 * image and a background colour, over `sharp`.
 *
 * In-house rather than `@capacitor/assets`, whose last release depends on a
 * Capacitor CLI three majors old and on Trapeze, and knows nothing of
 * variants. What it writes:
 *
 * - **iOS**: the single-size 1024x1024 `AppIcon` (Xcode 14+), flattened onto
 *   the background because an App Store icon carries no alpha; the launch
 *   screen's `Splash` image, the background with the icon centred.
 * - **Android**: the adaptive icon (its XML, a foreground per density on the
 *   108 dp canvas, the background colour resource), the legacy
 *   `ic_launcher` and `ic_launcher_round`, and `splash.png` in every density
 *   and orientation the template ships.
 *
 * The write set is fixed and listed ({@link outputs}): nothing else is
 * touched, and the same source and colour always produce the same bytes, so
 * a variant switch x, y, x leaves the files as they were.
 *
 * `sharp` is loaded on first use, from the CLI only: the browser-side `core`
 * never reaches it.
 */
export class NativeAssets {
  /**
   * The smallest raster source accepted: the iOS icon is 1024 px, and
   * nothing is upscaled.
   */
  public static readonly MIN_SIZE = 1024;

  /**
   * The background when the icon names none.
   */
  public static readonly DEFAULT_BACKGROUND = "#FFFFFF";

  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);

  protected readonly iosIconDir =
    "ios/App/App/Assets.xcassets/AppIcon.appiconset";
  protected readonly iosSplashDir =
    "ios/App/App/Assets.xcassets/Splash.imageset";
  protected readonly androidRes = "android/app/src/main/res";

  /**
   * Android densities and their scale over mdpi.
   */
  protected readonly densities: Array<[string, number]> = [
    ["mdpi", 1],
    ["hdpi", 1.5],
    ["xhdpi", 2],
    ["xxhdpi", 3],
    ["xxxhdpi", 4],
  ];

  /**
   * The portrait splash size per density, as Capacitor's template ships it.
   * Landscape is the same, turned.
   */
  protected readonly splashSizes: Record<string, [number, number]> = {
    mdpi: [320, 480],
    hdpi: [480, 800],
    xhdpi: [720, 1280],
    xxhdpi: [960, 1600],
    xxxhdpi: [1280, 1920],
  };

  /**
   * Every file {@link generate} writes for these platforms, relative to the
   * project root.
   */
  public outputs(platforms: CapacitorPlatform[]): string[] {
    return this.plan(platforms).map((it) => it.path);
  }

  /**
   * Validate the source, then write every icon and splash file. Nothing is
   * written when the source is refused.
   *
   * @returns the paths written, relative to the project root: those whose
   *   content changed
   */
  public async generate(
    root: string,
    icon: CapacitorIcon,
    platforms: CapacitorPlatform[],
  ): Promise<string[]> {
    const background = (
      icon.background ?? NativeAssets.DEFAULT_BACKGROUND
    ).toUpperCase();
    const source = await this.loadSource(root, icon.source);

    // Every file is rendered before the first write: a failure halfway
    // through rendering leaves the projects as they were.
    const files: Array<{ path: string; content: Buffer | string }> = [];
    for (const item of this.plan(platforms)) {
      files.push({
        path: item.path,
        content: await item.render(source, background),
      });
    }

    // A file that already holds these bytes is left alone, so a second run
    // writes nothing.
    const written: string[] = [];
    for (const file of files) {
      const path = this.fs.join(root, file.path);
      const content = Buffer.from(file.content);
      if (
        (await this.fs.exists(path)) &&
        content.equals(await this.fs.readFile(path))
      ) {
        continue;
      }
      await this.fs.writeFile(path, content);
      written.push(file.path);
    }
    if (written.length > 0) {
      this.log.info(
        `Generated ${written.length} icon and splash files from ${icon.source}`,
      );
    }
    return written;
  }

  /**
   * Read and check the source: square, a PNG or an SVG, and at least
   * {@link MIN_SIZE} px when raster. Returns it rasterised at that size or
   * larger, so every output is a downscale.
   */
  protected async loadSource(root: string, source: string): Promise<Buffer> {
    const path = this.fs.join(root, source);
    if (!(await this.fs.exists(path))) {
      throw new AlephaError(
        `The icon source ${source} does not exist (capacitor({ icon: { source } }) is relative to the project root).`,
      );
    }
    const input = await this.fs.readFile(path);
    const sharp = await this.sharp();

    let meta: { format?: string; width?: number; height?: number };
    try {
      meta = await sharp(input).metadata();
    } catch {
      throw new AlephaError(
        `The icon source ${source} is not an image sharp can read.`,
      );
    }
    const { format, width = 0, height = 0 } = meta;
    if (format !== "png" && format !== "svg") {
      throw new AlephaError(
        `The icon source ${source} is ${format ?? "unknown"}: use a PNG or an SVG.`,
      );
    }
    if (width === 0 || width !== height) {
      throw new AlephaError(
        `The icon source ${source} is ${width}x${height}: it must be square.`,
      );
    }
    if (format === "png" && width < NativeAssets.MIN_SIZE) {
      throw new AlephaError(
        `The icon source ${source} is ${width}x${height}: it must be at least ${NativeAssets.MIN_SIZE}x${NativeAssets.MIN_SIZE}, nothing is upscaled.`,
      );
    }

    if (format === "svg") {
      // Rasterised at a density that yields at least MIN_SIZE pixels, since
      // an SVG's own size is only its default rendering.
      const density = Math.max(
        72,
        Math.ceil((72 * NativeAssets.MIN_SIZE) / width),
      );
      return sharp(input, { density }).png().toBuffer();
    }
    return sharp(input).png().toBuffer();
  }

  /**
   * The files, each with how to render it.
   */
  protected plan(platforms: CapacitorPlatform[]): Array<{
    path: string;
    render: (source: Buffer, background: string) => Promise<Buffer | string>;
  }> {
    const files: Array<{
      path: string;
      render: (source: Buffer, background: string) => Promise<Buffer | string>;
    }> = [];

    if (platforms.includes("ios")) {
      files.push({
        path: `${this.iosIconDir}/AppIcon-512@2x.png`,
        render: (source, background) =>
          this.opaqueIcon(source, 1024, background),
      });
      files.push({
        path: `${this.iosIconDir}/Contents.json`,
        render: async () => this.iosIconContents(),
      });
      // The launch screen fills the screen with this square image: the icon
      // takes a fixed share of it, whatever the scale Xcode picks.
      for (const name of [
        "splash-2732x2732.png",
        "splash-2732x2732-1.png",
        "splash-2732x2732-2.png",
      ]) {
        files.push({
          path: `${this.iosSplashDir}/${name}`,
          render: (source, background) =>
            this.splash(source, 2732, 2732, background),
        });
      }
      files.push({
        path: `${this.iosSplashDir}/Contents.json`,
        render: async () => this.iosSplashContents(),
      });
    }

    if (platforms.includes("android")) {
      const res = this.androidRes;
      for (const [density, scale] of this.densities) {
        const legacy = Math.round(48 * scale);
        const canvas = Math.round(108 * scale);
        files.push({
          path: `${res}/mipmap-${density}/ic_launcher.png`,
          render: (source, background) =>
            this.opaqueIcon(source, legacy, background),
        });
        files.push({
          path: `${res}/mipmap-${density}/ic_launcher_round.png`,
          render: (source, background) =>
            this.roundIcon(source, legacy, background),
        });
        files.push({
          path: `${res}/mipmap-${density}/ic_launcher_foreground.png`,
          render: (source) => this.adaptiveForeground(source, canvas),
        });
        const [width, height] = this.splashSizes[density];
        files.push({
          path: `${res}/drawable-port-${density}/splash.png`,
          render: (source, background) =>
            this.splash(source, width, height, background),
        });
        files.push({
          path: `${res}/drawable-land-${density}/splash.png`,
          render: (source, background) =>
            this.splash(source, height, width, background),
        });
      }
      files.push({
        path: `${res}/drawable/splash.png`,
        render: (source, background) =>
          this.splash(source, 480, 320, background),
      });
      for (const name of ["ic_launcher", "ic_launcher_round"]) {
        files.push({
          path: `${res}/mipmap-anydpi-v26/${name}.xml`,
          render: async () => this.adaptiveIconXml(),
        });
      }
      files.push({
        path: `${res}/values/ic_launcher_background.xml`,
        render: async (_source, background) =>
          this.backgroundColorXml(background),
      });
    }

    return files;
  }

  /**
   * The icon at `size`, its transparency flattened onto the background, with
   * no alpha channel at all.
   */
  protected async opaqueIcon(
    source: Buffer,
    size: number,
    background: string,
  ): Promise<Buffer> {
    const sharp = await this.sharp();
    return sharp(source)
      .resize(size, size)
      .flatten({ background })
      .removeAlpha()
      .png()
      .toBuffer();
  }

  /**
   * The legacy round icon: the opaque icon inside a circle, transparent
   * around it.
   */
  protected async roundIcon(
    source: Buffer,
    size: number,
    background: string,
  ): Promise<Buffer> {
    const sharp = await this.sharp();
    const opaque = await this.opaqueIcon(source, size, background);
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`,
    );
    return sharp(opaque)
      .ensureAlpha()
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  }

  /**
   * The adaptive icon's foreground: the icon centred on the 108 dp canvas at
   * 66 dp, the safe zone every launcher mask keeps, transparent around it.
   */
  protected async adaptiveForeground(
    source: Buffer,
    canvas: number,
  ): Promise<Buffer> {
    const sharp = await this.sharp();
    const size = Math.round((canvas * 66) / 108);
    const icon = await sharp(source).resize(size, size).png().toBuffer();
    return sharp({
      create: {
        width: canvas,
        height: canvas,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: icon, gravity: "center" }])
      .png()
      .toBuffer();
  }

  /**
   * The background colour with the icon centred, at 30 % of the shorter side.
   */
  protected async splash(
    source: Buffer,
    width: number,
    height: number,
    background: string,
  ): Promise<Buffer> {
    const sharp = await this.sharp();
    const size = Math.round(Math.min(width, height) * 0.3);
    const icon = await sharp(source).resize(size, size).png().toBuffer();
    return sharp({
      create: { width, height, channels: 3, background },
    })
      .composite([{ input: icon, gravity: "center" }])
      .png()
      .toBuffer();
  }

  protected iosIconContents(): string {
    return `${JSON.stringify(
      {
        images: [
          {
            filename: "AppIcon-512@2x.png",
            idiom: "universal",
            platform: "ios",
            size: "1024x1024",
          },
        ],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    )}\n`;
  }

  protected iosSplashContents(): string {
    return `${JSON.stringify(
      {
        images: [
          {
            idiom: "universal",
            filename: "splash-2732x2732-2.png",
            scale: "1x",
          },
          {
            idiom: "universal",
            filename: "splash-2732x2732-1.png",
            scale: "2x",
          },
          { idiom: "universal", filename: "splash-2732x2732.png", scale: "3x" },
        ],
        info: { version: 1, author: "xcode" },
      },
      null,
      2,
    )}\n`;
  }

  protected adaptiveIconXml(): string {
    return [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
      '    <background android:drawable="@color/ic_launcher_background"/>',
      '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>',
      "</adaptive-icon>",
      "",
    ].join("\n");
  }

  protected backgroundColorXml(background: string): string {
    return [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      `    <color name="ic_launcher_background">${background}</color>`,
      "</resources>",
      "",
    ].join("\n");
  }

  /**
   * `sharp`, imported on first use: loading it starts libvips, which a CLI
   * command that generates nothing has no reason to pay for.
   */
  protected async sharp(): Promise<(typeof import("sharp"))["default"]> {
    return (await import("sharp")).default;
  }
}
