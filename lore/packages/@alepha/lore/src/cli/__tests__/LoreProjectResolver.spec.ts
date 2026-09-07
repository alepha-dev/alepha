import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * The four axes a `lore` invocation is about, and the two #1811 added.
 *
 * ⚠️ The remote rung is faked by swapping the `projects` client, not by
 * standing up a Lore. What is under test is the ORDER and the refusals; that
 * `getProjectBySlug` answers a project is Lore's own suite's business.
 */
describe("LoreProjectResolver", () => {
  const create = (
    env: Record<string, string> = {},
    // `null` is "Lore has no such project"; an omitted argument is the happy
    // path. A default parameter cannot express the first, since passing
    // `undefined` explicitly still takes the default.
    project: { id?: number; defaultEnv?: string } | null = { id: 1 },
  ) => {
    // Blanked unless a case sets them, for the reason `LoreClientService.spec`
    // records: a developer who has run this command for real has them
    // exported, and a spec that reads the ambient environment passes or fails
    // by machine.
    const alepha = Alepha.create({
      env: {
        LORE_API_KEY: "k",
        LORE_URL: "",
        LORE_PROJECT: "",
        LORE_APP: "",
        LORE_ENV: "",
        HOME: "/nonexistent",
        ...env,
      },
    }).with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const resolver = alepha.inject(LoreProjectResolver);
    const lookups: string[] = [];

    Object.assign(resolver as unknown as Record<string, unknown>, {
      projects: {
        getProjectBySlug: async ({ params }: { params: { slug: string } }) => {
          lookups.push(params.slug);
          return project ?? undefined;
        },
      },
    });

    return { resolver, fs, lookups };
  };

  describe("which app", () => {
    it("takes --app first, then LORE_APP", async () => {
      const { resolver } = create({ LORE_APP: "docs" });

      expect(await resolver.resolveApp("shop", "/project")).toBe("shop");
      expect(await resolver.resolveApp(undefined, "/project")).toBe("docs");
    });

    it("falls back to the package name, slugified the packer's way", async () => {
      const { resolver, fs } = create();
      // A scoped package has to land as `acme-app` in the registry and in the
      // filename alike. `WorkspacePacker.slugify` is the one derivation; a
      // second one here is what let `pack` write one file while `BayAdapter`
      // looked for another.
      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ name: "@acme/app" }),
      );

      expect(await resolver.resolveApp(undefined, "/project")).toBe("acme-app");
    });

    it("reads an empty LORE_APP as unset, so the package name still wins", async () => {
      // `||` and not `??`: `LORE_APP=` in a CI environment is present and
      // empty, and with `??` the artifact would be filed under "".
      const { resolver, fs } = create({ LORE_APP: "" });
      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ name: "lore" }),
      );

      expect(await resolver.resolveApp(undefined, "/project")).toBe("lore");
    });

    it("names the flag and the variable when there is no package.json", async () => {
      const { resolver } = create();

      await expect(
        resolver.resolveApp(undefined, "/elsewhere"),
      ).rejects.toThrowError(/--app <name>.*LORE_APP/s);
    });

    it("names them again when package.json has no name", async () => {
      const { resolver, fs } = create();
      await fs.writeFile("/project/package.json", JSON.stringify({}));

      await expect(
        resolver.resolveApp(undefined, "/project"),
      ).rejects.toThrowError(/--app <name>.*LORE_APP/s);
    });
  });

  describe("which environment", () => {
    it("takes --env first, then LORE_ENV, and asks Lore for neither", async () => {
      const { resolver, lookups } = create({ LORE_ENV: "staging" });

      expect(await resolver.resolveEnv("b14-production", "alepha")).toBe(
        "b14-production",
      );
      expect(await resolver.resolveEnv(undefined, "alepha")).toBe("staging");
      // The common path costs no request.
      expect(lookups).toEqual([]);
    });

    it("falls back to the project's own default, read from Lore", async () => {
      // ⚠️ A remote read and not a constant. `production` stopped being a safe
      // client-side default the moment environments became rows: a project may
      // run `b14-production` and have no `production` at all.
      const { resolver, lookups } = create(
        {},
        { id: 1, defaultEnv: "b14-production" },
      );

      expect(await resolver.resolveEnv(undefined, "alepha")).toBe(
        "b14-production",
      );
      expect(lookups).toEqual(["alepha"]);
    });

    it("reads an empty LORE_ENV as unset, so the project default still wins", async () => {
      const { resolver } = create(
        { LORE_ENV: "" },
        { id: 1, defaultEnv: "prod" },
      );

      expect(await resolver.resolveEnv(undefined, "alepha")).toBe("prod");
    });

    it("answers nothing when the project has set no default", async () => {
      // Not a throw: the caller knows how many environments the app has, and
      // one environment needs no flag. `assertEnv` is the refusal.
      const { resolver } = create({}, { id: 1 });

      expect(await resolver.resolveEnv(undefined, "alepha")).toBeUndefined();
    });

    it("answers nothing for a numeric project rather than guessing", async () => {
      // An id has no slug to look up, so the remote default is unreachable.
      const { resolver, lookups } = create();

      expect(await resolver.resolveEnv(undefined, "42")).toBeUndefined();
      expect(lookups).toEqual([]);
    });

    it("names the flag, the variable and the setting when it refuses", async () => {
      const { resolver } = create();

      expect(() => resolver.assertEnv(undefined, "docs")).toThrowError(
        /--env <name>.*LORE_ENV.*default environment/s,
      );
      expect(resolver.assertEnv("staging", "docs")).toBe("staging");
    });
  });

  describe("which project", () => {
    it("names the slug, the flag and the variable when it resolves nothing", async () => {
      const { resolver } = create({}, null);

      await expect(resolver.resolve("ghost")).rejects.toThrowError(
        /No Lore project named "ghost".*--project <slug>.*LORE_PROJECT/s,
      );
    });

    it("takes a numeric project as an id, with no round trip", async () => {
      const { resolver, lookups } = create();

      expect(await resolver.resolve("42")).toBe(42);
      expect(lookups).toEqual([]);
    });
  });
});
