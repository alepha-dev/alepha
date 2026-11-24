import { describe, it } from "vitest";

import { repositoryLinks } from "../src/api/schemas/repositoryForge.ts";

/**
 * A project's commit and pull request links, built from the repository URL
 * it names by the forge its host is on (#Q4217). GitHub is the one forge
 * implemented; any other host links nothing rather than a guess.
 */
describe("repositoryLinks", () => {
  it("builds GitHub's commit and pull request links from the repository's root", ({
    expect,
  }) => {
    const links = repositoryLinks("https://github.com/acme/api");
    expect(links?.forge).toBe("github");
    expect(links?.commit("0b35cb375ff")).toBe(
      "https://github.com/acme/api/commit/0b35cb375ff",
    );
    expect(links?.pullRequest(118)).toBe(
      "https://github.com/acme/api/pull/118",
    );
  });

  it("ignores a trailing slash and the host's case", ({ expect }) => {
    expect(repositoryLinks("https://GitHub.com/acme/api/")?.commit("abc")).toBe(
      "https://github.com/acme/api/commit/abc",
    );
  });

  it("links nothing without a URL, from a bare owner/name, or on a forge it does not know", ({
    expect,
  }) => {
    expect(repositoryLinks(undefined)).toBeUndefined();
    expect(repositoryLinks("")).toBeUndefined();
    expect(repositoryLinks("acme/api")).toBeUndefined();
    expect(repositoryLinks("ftp://github.com/acme/api")).toBeUndefined();
    expect(repositoryLinks("https://git.example.app/acme/api")).toBeUndefined();
  });
});
