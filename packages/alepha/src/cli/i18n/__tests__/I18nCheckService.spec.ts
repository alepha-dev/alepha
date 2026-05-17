import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nCheckService } from "../services/I18nCheckService.ts";

describe("I18nCheckService", () => {
  const ROOT = "/proj";

  const createEnv = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const service = alepha.inject(I18nCheckService);
    const fs = alepha.inject(MemoryFileSystemProvider);
    return { service, fs };
  };

  const dictionary = (keys: Record<string, string>) => {
    const body = Object.entries(keys)
      .map(([k, v]) => `        "${k}": "${v}",`)
      .join("\n");
    return `import { $dictionary } from "alepha/react/i18n";
export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
${body}
      },
    }),
  });
}
`;
  };

  let env: ReturnType<typeof createEnv>;
  beforeEach(() => {
    env = createEnv();
  });

  it("reports keys with no quoted reference as unused", async () => {
    await env.fs.mkdir(`${ROOT}/src/web`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/web/I18n.ts`,
      dictionary({ "home.title": "Home", "home.unused": "Nothing" }),
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/Home.tsx`,
      `export const Home = () => tr("home.title");`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.totalKeys).toBe(2);
    expect(result.unused).toEqual(["home.unused"]);
    expect(result.dictionaryFiles).toHaveLength(1);
  });

  it("exempts keys matching a dynamic prefix", async () => {
    await env.fs.mkdir(`${ROOT}/src`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/I18n.ts`,
      dictionary({
        "archive.type.directory": "Folder",
        "archive.type.folio": "Folio",
        "home.title": "Home",
      }),
    );
    await env.fs.writeFile(
      `${ROOT}/src/App.tsx`,
      "tr(`archive.type.${k}`); tr('home.title');",
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: ["archive.type."],
      exclude: [],
    });

    expect(result.unused).toEqual([]);
    expect(result.exemptKeys).toBe(2);
  });

  it("skips excluded paths and built-in excludes", async () => {
    await env.fs.mkdir(`${ROOT}/src/__tests__`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/I18n.ts`,
      dictionary({ "home.title": "Home" }),
    );
    // Reference lives only in an excluded test file — should not count.
    await env.fs.writeFile(
      `${ROOT}/src/__tests__/Home.spec.ts`,
      `tr("home.title");`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.unused).toEqual(["home.title"]);
  });

  it("returns totalKeys=0 when no dictionary is found", async () => {
    await env.fs.mkdir(`${ROOT}/src`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/App.tsx`,
      `export const App = () => "hi";`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.totalKeys).toBe(0);
  });
});
