import { $module, Alepha, type AppSurface, lazyService } from "alepha";
import { describe, it } from "vitest";

import { $action, AlephaServer, ServerProvider } from "../index.ts";

/**
 * A controller the build made a lazy chunk (#Q3407): its module lists a
 * stand-in, the container declares it by key, and imports the chunk before
 * creating the class on its first request.
 */
let created = 0;

// A fresh class per container: adopting a stand-in tags the class with the
// module that listed it, as the module file's own import would have.
const controller = () =>
  class QuestApi {
    constructor() {
      created++;
    }
    list = $action({ method: "GET", path: "/quests", handler: () => "quests" });
  };

const surface: AppSurface = {
  version: 1,
  classes: [{ key: "acme.api:QuestApi", pure: true }],
  actions: [
    {
      name: "list",
      group: "QuestApi",
      method: "GET",
      path: "/quests",
      class: "acme.api:QuestApi",
    },
  ],
  routes: [],
  pages: [],
  jobs: [],
  tools: [],
  resources: [],
  prompts: [],
};

const boot = async (
  opts: { list?: boolean; failures?: number; via?: "module" | "with" } = {},
) => {
  created = 0;
  let imports = 0;
  let failures = opts.failures ?? 0;
  const QuestApi = controller();
  const lazy = lazyService("QuestApi", async () => {
    imports++;
    if (failures > 0) {
      failures--;
      throw new Error("chunk missing");
    }
    return QuestApi;
  });
  const alepha = Alepha.create({ env: { SERVER_PORT: 0 } });
  if (opts.list !== false) {
    // `alepha.with(X)` in a main file keys the class by its name alone.
    alepha.useSurface(
      opts.via === "with"
        ? {
            ...surface,
            classes: [{ key: "QuestApi", pure: true }],
            actions: surface.actions.map((it) => ({
              ...it,
              class: "QuestApi",
            })),
          }
        : surface,
    );
  }
  alepha.with(AlephaServer);
  if (opts.via === "with") {
    alepha.with(lazy);
  } else {
    alepha.with($module({ name: "acme.api", services: [lazy] }));
  }
  await alepha.start();
  const host = alepha.inject(ServerProvider).hostname;
  return { alepha, host, imports: () => imports, QuestApi };
};

describe("lazy chunks", () => {
  it("import the chunk once, on the first request, and create the class once", async ({
    expect,
  }) => {
    const { alepha, host, imports } = await boot();
    expect(imports()).toBe(0);
    const answers = await Promise.all(
      [1, 2, 3].map(() => fetch(`${host}/api/quests`).then((it) => it.text())),
    );
    expect(answers).toEqual(["quests", "quests", "quests"]);
    expect(imports()).toBe(1);
    expect(created).toBe(1);
    await alepha.stop();
  });

  it("fail the request whose import fails, and retry on the next", async ({
    expect,
  }) => {
    const { alepha, host, imports } = await boot({ failures: 1 });
    const first = await fetch(`${host}/api/quests`);
    expect(first.status).toBe(500);
    const second = await fetch(`${host}/api/quests`);
    expect(await second.text()).toBe("quests");
    expect(imports()).toBe(2);
    await alepha.stop();
  });

  it("are imported and created at start when nothing defers them", async ({
    expect,
  }) => {
    const { alepha, host, imports } = await boot({ list: false });
    expect(imports()).toBe(1);
    expect(created).toBe(1);
    expect(await (await fetch(`${host}/api/quests`)).text()).toBe("quests");
    await alepha.stop();
  });

  it("let a file importing the class statically create it after start", async ({
    expect,
  }) => {
    const { alepha, QuestApi } = await boot();
    expect(alepha.inject(QuestApi)).toBeInstanceOf(QuestApi);
    await alepha.stop();
  });

  it("are declared when a main file passes them to alepha.with", async ({
    expect,
  }) => {
    for (const list of [true, false]) {
      const { alepha, host } = await boot({ via: "with", list });
      expect(created).toBe(list ? 0 : 1);
      expect(await (await fetch(`${host}/api/quests`)).text()).toBe("quests");
      expect(created).toBe(1);
      await alepha.stop();
    }
  });
});
