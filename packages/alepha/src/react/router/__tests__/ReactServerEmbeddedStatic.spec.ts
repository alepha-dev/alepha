import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import {
  type StaticFileSource,
  type StaticFileStat,
  staticEmbeddedAtom,
} from "alepha/server/static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { $page } from "../index.ts";
import { ReactServerProvider } from "../providers/ReactServerProvider.ts";

/**
 * Stands in for the embedded source, which needs Bun: it serves every path of
 * the map it was given with the same body.
 */
class InMemorySource implements StaticFileSource {
  protected readonly paths: string[];

  constructor(paths: string[]) {
    this.paths = paths;
  }

  public async list(): Promise<string[]> {
    return this.paths;
  }

  public async stat(): Promise<StaticFileStat> {
    return { size: 15, mtime: new Date(0) };
  }

  public async has(path: string): Promise<boolean> {
    return this.paths.includes(path);
  }

  public async open(): Promise<Readable> {
    return Readable.from([Buffer.from("from the binary")]);
  }
}

/**
 * A `public/` directory that exists on disk, the one a compiled binary must
 * NOT serve when it carries its own build.
 */
let diskPublic = "";

class TestReactServerProvider extends ReactServerProvider {
  public embeddedFrom?: { files: Record<string, string>; builtAt: number };

  protected override createEmbeddedSource(
    files: Record<string, string>,
    builtAt: number,
  ): StaticFileSource {
    this.embeddedFrom = { files, builtAt };
    return new InMemorySource(Object.keys(files));
  }

  protected override async getPublicDirectory(): Promise<string> {
    return diskPublic;
  }
}

class App {
  home = $page({ path: "/", component: () => "home" });
}

const start = async (embedded?: {
  builtAt: number;
  files: Record<string, string>;
}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } })
    .with({ provide: ReactServerProvider, use: TestReactServerProvider })
    .with(App);
  if (embedded) {
    alepha.store.set(staticEmbeddedAtom, embedded);
  }
  await alepha.start();
  return {
    alepha,
    hostname: alepha.inject(ServerProvider).hostname,
    provider: alepha.inject(ReactServerProvider) as TestReactServerProvider,
  };
};

beforeAll(async () => {
  diskPublic = await mkdtemp(join(tmpdir(), "alepha-react-public-"));
  await writeFile(join(diskPublic, "app.css"), "from disk");
});

afterAll(async () => {
  await rm(diskPublic, { recursive: true, force: true });
});

describe("ReactServerProvider static files", () => {
  it("serves the files embedded in the binary, not a public/ directory beside it", async () => {
    const { alepha, hostname, provider } = await start({
      builtAt: 1767323045000,
      files: { "/app.css": "/$bunfs/root/app-1a2b.css" },
    });

    const response = await fetch(`${hostname}/app.css`);
    expect(await response.text()).toBe("from the binary");
    expect(provider.embeddedFrom).toEqual({
      files: { "/app.css": "/$bunfs/root/app-1a2b.css" },
      builtAt: 1767323045000,
    });

    await alepha.stop();
  });

  it("serves the public/ directory when the binary embeds nothing", async () => {
    const { alepha, hostname, provider } = await start();

    const response = await fetch(`${hostname}/app.css`);
    expect(await response.text()).toBe("from disk");
    expect(provider.embeddedFrom).toBeUndefined();

    await alepha.stop();
  });
});
