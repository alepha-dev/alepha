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
    project: { id?: number } | null = { id: 1 },
    // Every deployed copy in the project, the shape `listApps` answers.
    instances: Array<{ app: string; env: string }> = [],
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
    const listed: number[] = [];

    Object.assign(resolver as unknown as Record<string, unknown>, {
      projects: {
        getProjectBySlug: async ({ params }: { params: { slug: string } }) => {
          lookups.push(params.slug);
          return project ?? undefined;
        },
      },
      apps: {
        listApps: async ({ params }: { params: { projectId: number } }) => {
          listed.push(params.projectId);
          return { items: instances, apps: [] };
        },
      },
    });

    return { resolver, fs, lookups, listed };
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
      const { resolver, listed } = create({ LORE_ENV: "staging" });

      expect(await resolver.resolveEnv("b14-production", 1, "docs")).toBe(
        "b14-production",
      );
      expect(await resolver.resolveEnv(undefined, 1, "docs")).toBe("staging");
      // The common path costs no request.
      expect(listed).toEqual([]);
    });

    it("takes the app's only environment when nothing named one", async () => {
      // ⚠️ The rows, not the project's old `defaultEnv`. One row is the only
      // place that app can go, so a setting that disagreed with it could only
      // ever be wrong.
      const { resolver, listed } = create({}, { id: 1 }, [
        { app: "docs", env: "b14-production" },
        // Another app's rows are not this app's answer.
        { app: "lore", env: "staging" },
        { app: "lore", env: "production" },
      ]);

      expect(await resolver.resolveEnv(undefined, 7, "docs")).toBe(
        "b14-production",
      );
      expect(listed).toEqual([7]);
    });

    it("refuses and names them when the app has several", async () => {
      const { resolver } = create({}, { id: 1 }, [
        { app: "docs", env: "production" },
        { app: "docs", env: "preview" },
      ]);

      await expect(
        resolver.resolveEnv(undefined, 1, "docs"),
      ).rejects.toThrowError(
        "docs has production, preview. Pass --env <name>.",
      );
    });

    it("answers production for an app with no rows, so the refusal downstream names it", async () => {
      // It cannot succeed either way - a deploy never creates a row - and
      // `loadInstance`'s message says which pair is missing and where to make
      // it, which beats anything this method could write.
      const { resolver } = create({}, { id: 1 }, [
        { app: "lore", env: "staging" },
      ]);

      expect(await resolver.resolveEnv(undefined, 1, "docs")).toBe(
        "production",
      );
    });

    it("reads an empty LORE_ENV as unset, so the rows still answer", async () => {
      const { resolver } = create({ LORE_ENV: "" }, { id: 1 }, [
        { app: "docs", env: "prod" },
      ]);

      expect(await resolver.resolveEnv(undefined, 1, "docs")).toBe("prod");
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
