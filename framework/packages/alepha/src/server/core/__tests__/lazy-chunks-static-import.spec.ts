import { $inject, $module, Alepha, type AppSurface, lazyService } from "alepha";
import { AlephaServerLinks } from "alepha/server/links";
import { describe, it } from "vitest";

import { $action, ServerProvider } from "../index.ts";

/**
 * A controller whose module lists it as a lazy chunk, also imported
 * statically by another class (#Q3407): when that class creates it, the live
 * class takes its stand-in's place. Left declared beside it, `/api/_links`
 * listed its actions twice and answered 500 ("Duplicate action name").
 */
const make = () => {
  class FileApi {
    findFiles = $action({
      method: "GET",
      path: "/files",
      handler: () => "files",
    });
  }
  // Pure, created late, and injecting FileApi by its class.
  class UploadApi {
    files = $inject(FileApi);
    upload = $action({
      method: "GET",
      path: "/upload",
      handler: () => "uploaded",
    });
  }
  // A boot class injecting FileApi by its class.
  class FileBoot {
    files = $inject(FileApi);
  }
  return { FileApi, UploadApi, FileBoot };
};

const row = (name: string, path: string, cls: string) => ({
  name,
  group: cls.split(":")[1],
  method: "GET",
  path,
  class: cls,
});

const surface: AppSurface = {
  version: 1,
  classes: [
    { key: "acme.files:FileApi", pure: true },
    { key: "acme.files:UploadApi", pure: true },
  ],
  actions: [
    row("findFiles", "/files", "acme.files:FileApi"),
    row("upload", "/upload", "acme.files:UploadApi"),
  ],
  routes: [],
  pages: [],
  jobs: [],
  tools: [],
  resources: [],
  prompts: [],
};

const boot = async (opts: { bootClass?: boolean } = {}) => {
  const { FileApi, UploadApi, FileBoot } = make();
  const lazy = lazyService("FileApi", async () => FileApi);
  const alepha = Alepha.create({ env: { SERVER_PORT: 0 } }).useSurface(surface);
  alepha.with(AlephaServerLinks).with(
    $module({
      name: "acme.files",
      services: opts.bootClass
        ? [lazy, UploadApi, FileBoot]
        : [lazy, UploadApi],
    }),
  );
  await alepha.start();
  const host = alepha.inject(ServerProvider).hostname;
  const links = async () => {
    const response = await fetch(`${host}/api/_links`);
    return {
      status: response.status,
      names: response.ok
        ? Object.keys(
            ((await response.json()) as { actions: Record<string, unknown> })
              .actions,
          ).sort()
        : [],
    };
  };
  return { alepha, host, links };
};

describe("a lazy chunk's class imported statically", () => {
  it("takes its stand-in's place when a late class creates it", async ({
    expect,
  }) => {
    const { alepha, host, links } = await boot();
    expect(await (await fetch(`${host}/api/upload`)).text()).toBe("uploaded");
    expect(await links()).toEqual({
      status: 200,
      names: ["findFiles", "upload"],
    });
    expect(await (await fetch(`${host}/api/files`)).text()).toBe("files");
    await alepha.stop();
  });

  it("takes its stand-in's place when a boot class creates it", async ({
    expect,
  }) => {
    const { alepha, host, links } = await boot({ bootClass: true });
    expect(await links()).toEqual({
      status: 200,
      names: ["findFiles", "upload"],
    });
    expect(await (await fetch(`${host}/api/files`)).text()).toBe("files");
    await alepha.stop();
  });
});
