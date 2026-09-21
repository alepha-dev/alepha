import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { ImageCommand } from "../commands/image.ts";
import { DockerImageBuilder } from "../services/DockerImageBuilder.ts";

/**
 * ⚠️ **The libc decision, which is where a compiled image goes wrong.**
 *
 * A Bun `--compile` binary is NOT fully static: the target triple picks the
 * libc. Put a glibc binary on `scratch` or on `distroless/static` (which
 * carries no libc at all) and the result is not a build failure — it is an
 * image whose binary exits immediately, with an error saying nothing about
 * why.
 *
 * So `alepha image` derives the triple from the BASE rather than inheriting
 * whatever `alepha compile` would default to, which is the host's libc and is
 * right for almost none of these.
 */
describe("alepha image, choosing a Bun triple for a base", () => {
  class TestImageCommand extends ImageCommand {
    public testUsesMusl = (base: string) => this.usesMusl(base);
    public testPrimaryRuntime = (manifest: unknown) =>
      this.primaryRuntime(manifest as any);
    public testAssertBase = (base: string) =>
      this.assertBaseCanRunABinary(base);
  }

  const command = () => Alepha.create().inject(TestImageCommand);

  it("wants a glibc binary for the default compiled base", ({ expect }) => {
    // `cc-debian12` carries glibc, `libstdc++` and `libgcc`, which is exactly
    // the set a Bun binary turns out to need. Named once on the builder, which
    // also writes it into the Dockerfile: two copies would eventually
    // disagree.
    expect(
      command().testUsesMusl(DockerImageBuilder.DEFAULT_COMPILE_BASE),
    ).toBe(false);
  });

  it("wants a musl binary for an alpine base", ({ expect }) => {
    const cmd = command();
    expect(cmd.testUsesMusl("alpine:3.20")).toBe(true);
    expect(cmd.testUsesMusl("oven/bun:alpine")).toBe(true);
  });

  /**
   * An unrecognised base is treated as glibc, which is what `debian`,
   * `ubuntu` and every distroless image but the alpine-flavoured ones are.
   */
  it("assumes glibc for a base it does not recognise", ({ expect }) => {
    const cmd = command();
    expect(cmd.testUsesMusl("gcr.io/distroless/base-debian12")).toBe(false);
    expect(cmd.testUsesMusl("debian:bookworm-slim")).toBe(false);
    expect(cmd.testUsesMusl("ubuntu:24.04")).toBe(false);
    expect(cmd.testUsesMusl("node:26-slim")).toBe(false);
  });

  // The registry and the tag travel with a base image, so the match cannot be
  // an exact one.
  it("matches through a registry prefix and a tag", ({ expect }) => {
    expect(command().testUsesMusl("Alpine:3.20")).toBe(true);
  });

  /**
   * ⚠️ The bug this quest's proof step actually found. `distroless/static`
   * WAS the default base, and a Bun binary could never have run on it: the
   * binary is dynamically linked under every triple, needing an interpreter,
   * `libstdc++` and `libgcc`. What that produced was
   * `exec /app/app: no such file or directory` — an error naming a file that
   * is right there, from a container that simply stops.
   *
   * No triple fixes a base with no libc, so it is refused rather than
   * silently built.
   */
  describe("a base with no libc", () => {
    it("is refused by name, and names the working alternative", ({
      expect,
    }) => {
      const cmd = command();
      for (const base of ["scratch", "gcr.io/distroless/static-debian12"]) {
        expect(() => cmd.testAssertBase(base)).toThrow(/carries no libc/);
        expect(() => cmd.testAssertBase(base)).toThrow(
          /distroless\/cc-debian12/,
        );
      }
    });

    it("lets a base that has one through", ({ expect }) => {
      const cmd = command();
      expect(() =>
        cmd.testAssertBase(DockerImageBuilder.DEFAULT_COMPILE_BASE),
      ).not.toThrow();
      expect(() => cmd.testAssertBase("alpine:3.20")).not.toThrow();
    });
  });

  describe("which slice the image runs", () => {
    it("takes the first declared runtime", ({ expect }) => {
      expect(
        command().testPrimaryRuntime({
          runtime: "node",
          runtimes: [
            { runtime: "node", entry: "index.node.js" },
            { runtime: "workerd", entry: "index.workerd.js" },
          ],
        }),
      ).toBe("node");
    });

    it("reads the scalar when the artifact declares no slices", ({
      expect,
    }) => {
      expect(command().testPrimaryRuntime({ runtime: "bun" })).toBe("bun");
    });

    // Never a preference of its own: the same two slices the other way round
    // give the other answer.
    it("never reorders", ({ expect }) => {
      expect(
        command().testPrimaryRuntime({
          runtime: "bun",
          runtimes: [
            { runtime: "bun", entry: "index.bun.js" },
            { runtime: "node", entry: "index.node.js" },
          ],
        }),
      ).toBe("bun");
    });
  });
});
