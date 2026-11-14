import type { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  ArtifactController,
  ImageRegistryClient,
  RegistryCredentialController,
  RegistryCredentialService,
  RegistryTransport,
} from "../src/api/index.ts";
import { MemoryRegistryTransport } from "../src/testing/index.ts";
import {
  bootStackSpec,
  newUser,
  stackWorld,
  type StackWorld,
} from "./support/stackWorld.ts";

/**
 * A project's registry credentials, and images from any registry (#Q2693).
 *
 * The properties: no response ever carries a secret; a private registry is
 * read with the project's OWN credential and nobody else's; a host nobody
 * holds a credential for is still refused before any fetch.
 */
describe("registry credentials", () => {
  let alepha: Alepha;
  let registry: MemoryRegistryTransport;

  beforeEach(async () => {
    alepha = await bootStackSpec((a) => {
      a.with({ provide: RegistryTransport, use: MemoryRegistryTransport });
    });
    registry = alepha.inject(MemoryRegistryTransport);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const setCredential = (
    w: StackWorld,
    host: string,
    secret = "glpat-supersecret-token",
  ) =>
    alepha.inject(RegistryCredentialController).setRegistryCredential.fetch(
      {
        params: { projectId: w.project.id },
        body: { host, username: "ci", secret },
      },
      { user: w.user },
    );

  /**
   * A private registry behind a Bearer challenge, GitLab-style: the realm is
   * another host, and it answers a token only for the right Basic auth.
   */
  const privateRegistry = (host: string, basic: string) => {
    registry
      .on("/v2/", {
        status: 401,
        headers: {
          "www-authenticate": `Bearer realm="https://auth.corp.test/jwt/auth",service="container_registry"`,
        },
      })
      .on("auth.corp.test/jwt/auth", { status: 401 });
    registry.healthy({ repository: "team/api", tag: "1.0.0" });
    registry.on("/token", { status: 404 });
    const original = registry.fetch.bind(registry);
    registry.fetch = async (url, init) => {
      if (url.startsWith("https://auth.corp.test/jwt/auth")) {
        registry.calls.push({ url, headers: init.headers });
        return init.headers.authorization === basic
          ? new Response(JSON.stringify({ token: "scoped-token" }), {
              status: 200,
            })
          : new Response("", { status: 401 });
      }
      return await original(url, init);
    };
    return `${host}/team/api:1.0.0`;
  };

  describe("what a response may say", () => {
    it("never answers the secret, on the write or on the list", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const written = (await setCredential(w, "Registry.GitLab.com")).data;
      expect(written.host).toBe("registry.gitlab.com");
      const listed = (
        await alepha
          .inject(RegistryCredentialController)
          .listRegistryCredentials.fetch(
            { params: { projectId: w.project.id } },
            { user: w.user },
          )
      ).data;
      expect(JSON.stringify([written, listed])).not.toContain("supersecret");
      expect(Object.keys(listed.items[0]).sort()).toEqual([
        "host",
        "id",
        "updatedAt",
        "updatedBy",
        "username",
      ]);
    });

    it("refuses a stranger's write, and a host that is an IP or a URL", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stranger = await newUser(alepha);
      await expect(
        alepha.inject(RegistryCredentialController).setRegistryCredential.fetch(
          {
            params: { projectId: w.project.id },
            body: { host: "registry.corp.test", username: "u", secret: "s" },
          },
          { user: stranger },
        ),
      ).rejects.toThrow();
      await expect(setCredential(w, "10.0.0.5:5000")).rejects.toThrow(
        "not a registry host",
      );
      await expect(
        setCredential(w, "https://registry.corp.test"),
      ).rejects.toThrow("not a registry host");
    });
  });

  describe("reading an image from a private registry", () => {
    it("answers the standard v2 Bearer challenge with the credential, any host and port", async ({
      expect,
    }) => {
      const reference = privateRegistry(
        "harbor.corp.test:8443",
        `Basic ${btoa("ci:token")}`,
      );
      const image = await alepha
        .inject(ImageRegistryClient)
        .read(reference, undefined, {
          credential: {
            host: "harbor.corp.test:8443",
            username: "ci",
            password: "token",
          },
        });
      expect(image.digest).toBe("a".repeat(64));
      const manifest = registry.calls.find((c) =>
        c.url.includes("/manifests/1.0.0"),
      );
      expect(manifest?.headers.authorization).toBe("Bearer scoped-token");
    });

    it("sends the credential itself to a registry that asks for Basic auth", async ({
      expect,
    }) => {
      registry.on("/v2/", {
        status: 401,
        headers: { "www-authenticate": 'Basic realm="registry"' },
      });
      registry.healthy({ repository: "team/api", tag: "1.0.0" });
      await alepha
        .inject(ImageRegistryClient)
        .read("registry.corp.test/team/api:1.0.0", undefined, {
          credential: {
            host: "registry.corp.test",
            username: "ci",
            password: "token",
          },
        });
      const manifest = registry.calls.find((c) =>
        c.url.includes("/manifests/1.0.0"),
      );
      expect(manifest?.headers.authorization).toBe(`Basic ${btoa("ci:token")}`);
    });

    it("still refuses a host nobody holds a credential for, and an IP, before any fetch", ({
      expect,
    }) => {
      const client = alepha.inject(ImageRegistryClient);
      expect(() => client.parse("registry.corp.test/team/api:1")).toThrow(
        'Lore does not read images from "registry.corp.test"',
      );
      expect(() => client.parse("10.0.0.5/team/api:1", ["10.0.0.5"])).toThrow(
        "never by IP address",
      );
      expect(() =>
        client.parse("registry.corp.test:5000/team/api:1", [
          "registry.corp.test",
        ]),
      ).toThrow("port");
      expect(registry.calls).toEqual([]);
    });
  });

  describe("an image push uses the project's own credential", () => {
    it("records an image from a private registry, and another project cannot borrow the credential", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      await setCredential(w, "harbor.corp.test", "token");
      const reference = privateRegistry(
        "harbor.corp.test",
        `Basic ${btoa("ci:token")}`,
      );
      const pushed = (
        await alepha.inject(ArtifactController).pushImage.fetch(
          {
            params: { projectId: w.project.id },
            body: { app: "api", tag: "1.0.0", reference },
          },
          { user: w.user },
        )
      ).data;
      expect(pushed.artifact.reference).toBe(reference);

      const other = await stackWorld(alepha);
      await expect(
        alepha.inject(ArtifactController).pushImage.fetch(
          {
            params: { projectId: other.project.id },
            body: { app: "api", tag: "1.0.0", reference },
          },
          { user: other.user },
        ),
      ).rejects.toThrow('Lore does not read images from "harbor.corp.test"');

      const forDeploy = await alepha
        .inject(RegistryCredentialService)
        .forDeploy(other.project.id);
      expect(forDeploy).toEqual([]);
      const own = await alepha
        .inject(RegistryCredentialService)
        .forDeploy(w.project.id);
      expect(own).toEqual([
        { host: "harbor.corp.test", username: "ci", password: "token" },
      ]);
    });
  });
});
