import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { afterEach, describe, expect, it } from "vitest";

import { MetaResolver } from "../services/MetaResolver.ts";

const TAG = "git tag --points-at HEAD";
const SHA = "git rev-parse --short HEAD";

const setup = (
  outputs: Record<string, string>,
  errors?: Record<string, string>,
) => {
  const alepha = Alepha.create().with({
    provide: ShellProvider,
    use: MemoryShellProvider,
  });
  alepha.inject(MemoryShellProvider).configure({ outputs, errors });
  return alepha.inject(MetaResolver);
};

describe("MetaResolver", () => {
  describe("version", () => {
    it("should take the git tag on HEAD", async () => {
      const meta = await setup({ [TAG]: "0.27.1\n" }).resolve({
        root: "/w/lore",
        runtime: "workerd",
        dev: false,
      });

      expect(meta.version).toBe("0.27.1");
    });

    it("should strip a leading v, so v0.27.1 and 0.27.1 report the same", async () => {
      const meta = await setup({ [TAG]: "v0.27.1\n" }).resolve({
        root: "/w/lore",
        runtime: "node",
        dev: false,
      });

      expect(meta.version).toBe("0.27.1");
    });

    it("should report latest on an untagged commit", async () => {
      // The normal case for a continuously deployed app: tags are created per
      // release, so most deploys are genuinely not a tagged version.
      const meta = await setup({ [TAG]: "" }).resolve({
        root: "/w/lore",
        runtime: "workerd",
        dev: false,
      });

      expect(meta.version).toBe("latest");
    });

    it("should report latest when git is unavailable entirely", async () => {
      const meta = await setup({}, { [TAG]: "not a git repository" }).resolve({
        root: "/w/lore",
        runtime: "node",
        dev: false,
      });

      expect(meta.version).toBe("latest");
    });

    it("should take the first tag when several point at HEAD", async () => {
      const meta = await setup({
        [TAG]: "0.27.1\nrelease-candidate\n",
      }).resolve({
        root: "/w/lore",
        runtime: "node",
        dev: false,
      });

      expect(meta.version).toBe("0.27.1");
    });
  });

  describe("commit", () => {
    it("should resolve even on an untagged commit, which is what identifies that build", async () => {
      const meta = await setup({ [TAG]: "", [SHA]: "6faea71\n" }).resolve({
        root: "/w/lore",
        runtime: "workerd",
        dev: false,
      });

      expect(meta.version).toBe("latest");
      expect(meta.commit).toBe("6faea71");
    });

    it('should be absent rather than "unknown" when there is no git', async () => {
      // Absence is the signal. A literal "unknown" would be a value consumers
      // have to special-case, which is the boilerplate this replaces.
      const meta = await setup({}, { [SHA]: "not a git repository" }).resolve({
        root: "/w/lore",
        runtime: "node",
        dev: false,
      });

      expect(meta.commit).toBeUndefined();
    });
  });

  describe("name", () => {
    it("should slugify the root basename, matching the manifest's project", async () => {
      const meta = await setup({}).resolve({
        root: "/w/My App",
        runtime: "node",
        dev: false,
      });

      expect(meta.name).toBe("my-app");
    });
  });

  describe("override", () => {
    it("should let an app publish its own version instead of the tag", async () => {
      // What lore needs: a private package with no version of its own that
      // deliberately publishes the framework's, and which deploys on every
      // push to main where a tag-only chain would say "latest" forever.
      const meta = await setup({ [TAG]: "0.27.1\n" }).resolve({
        root: "/w/lore",
        runtime: "workerd",
        dev: false,
        override: { version: "9.9.9" },
      });

      expect(meta.version).toBe("9.9.9");
    });

    it("should ignore an override whose value is empty, rather than publish a blank", async () => {
      const meta = await setup({ [TAG]: "0.27.1\n" }).resolve({
        root: "/w/lore",
        runtime: "node",
        dev: false,
        override: { version: "" },
      });

      expect(meta.version).toBe("0.27.1");
    });
  });

  describe("build", () => {
    it("should carry the runtime it was built for", async () => {
      const meta = await setup({}).resolve({
        root: "/w/lore",
        runtime: "workerd",
        dev: false,
      });

      expect(meta.build.runtime).toBe("workerd");
      expect(meta.build.dev).toBe(false);
    });

    it("should mark a dev-server record as dev, so its date is not read as a build", async () => {
      const meta = await setup({}).resolve({
        root: "/w/lore",
        runtime: "node",
        dev: true,
      });

      expect(meta.build.dev).toBe(true);
    });

    it("should always stamp a date, unlike the no-build fallback", async () => {
      const meta = await setup({}).resolve({
        root: "/w/lore",
        runtime: "node",
        dev: false,
      });

      expect(meta.build.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("define", () => {
    it("should bake the record as a JSON string, so no transform can reparse it as a block", async () => {
      const resolver = setup({ [TAG]: "0.27.1\n" });
      const meta = await resolver.resolve({
        root: "/w/lore",
        runtime: "workerd",
        dev: false,
      });

      const value = resolver.define(meta).__ALEPHA_META__;

      // Double-encoded on purpose: `define` substitutes the value as raw
      // source, so this has to BE a string literal in the output, not an
      // object literal that a parser could take for a block.
      expect(value.startsWith('"')).toBe(true);
      expect(JSON.parse(JSON.parse(value))).toEqual(meta);
    });

    it("should survive a value containing quotes without breaking the substitution", async () => {
      const resolver = setup({});
      const meta = await resolver.resolve({
        root: "/w/lore",
        runtime: "node",
        dev: false,
        override: { name: 'we"ird' },
      });

      const value = resolver.define(meta).__ALEPHA_META__;

      expect(JSON.parse(JSON.parse(value)).name).toBe('we"ird');
    });
  });

  describe("framework", () => {
    it("should report alepha's own version, baked rather than resolved at runtime", async () => {
      const meta = await setup({}).resolve({
        root: "/w/lore",
        runtime: "node",
        dev: false,
      });

      // Baked here because `alepha/package.json` is not resolvable on every
      // target the bundle runs on.
      expect(meta.framework).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("install", () => {
    afterEach(() => {
      delete (globalThis as Record<string, unknown>).__ALEPHA_META__;
    });

    /**
     * `BuildPrerenderTask` renders pages and routes IN-PROCESS, inside the
     * CLI, where the build token was never substituted. Without this the
     * prerendered HTML carries the no-build fallback while the bundles beside
     * it carry the real record - `alepha.dev` shipped a header reading
     * "v latest" that way, corrected only once hydration replaced it.
     */
    it("should make the record visible to an in-process render", async () => {
      const resolver = setup({ [TAG]: "0.27.1\n" });
      const meta = await resolver.resolve({
        root: "/w/docs",
        runtime: "static",
        dev: false,
      });

      resolver.install(meta);

      expect(Alepha.create().meta).toEqual(meta);
    });

    it("should install a string, so the typeof guard in core sees a binding", async () => {
      const resolver = setup({});
      const meta = await resolver.resolve({
        root: "/w/docs",
        runtime: "node",
        dev: false,
      });

      resolver.install(meta);

      // Core reads `typeof __ALEPHA_META__ === "string"` and JSON.parses it.
      // An object here would satisfy the guard and then throw on parse.
      expect(
        typeof (globalThis as Record<string, unknown>).__ALEPHA_META__,
      ).toBe("string");
    });
  });
});
