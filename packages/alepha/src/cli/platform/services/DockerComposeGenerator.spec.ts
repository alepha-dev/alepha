import { Alepha } from "alepha";
import { describe, test } from "vitest";
import type { AppDefinition } from "../adapters/PlatformAdapter.ts";
import { DockerComposeGenerator } from "./DockerComposeGenerator.ts";
import { NamingService } from "./NamingService.ts";

describe("DockerComposeGenerator", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create();
    const generator = alepha.inject(DockerComposeGenerator);
    const naming = alepha.inject(NamingService);
    return { generator, naming };
  };

  const makeApp = (overrides: Partial<AppDefinition> = {}): AppDefinition => ({
    name: "api",
    path: "",
    entry: { root: "/project", server: "src/main.ts" },
    resources: {
      hasDatabase: false,
      hasBucket: false,
      hasKV: false,
      hasQueue: false,
      hasCron: false,
    },
    ...overrides,
  });

  describe("generateTraefik", () => {
    test("generates shared traefik compose", ({ expect }) => {
      const { generator } = createTestEnv();

      const result = generator.generateTraefik();

      expect(result).toContain("traefik:");
      expect(result).toContain("container_name: alepha-traefik");
      expect(result).toContain("image: traefik:v3");
      expect(result).toContain("80:80");
      expect(result).toContain("443:443");
      expect(result).toContain("certificatesresolvers");
      expect(result).toContain("alepha-proxy");
      expect(result).toContain("traefik_certs:");
    });
  });

  describe("generateLocal", () => {
    test("generates postgres service when app has database and no DATABASE_URL", ({
      expect,
    }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "local");

      const result = generator.generateLocal({
        project: "myapp",
        env: "local",
        naming: namingCtx,
        apps: [
          makeApp({
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: {},
      });

      expect(result).toContain("postgres:");
      expect(result).toContain("image: postgres:17-alpine");
      expect(result).toContain("5432:5432");
      expect(result).toContain("POSTGRES_DB: myapp_local");
      expect(result).toContain("postgres_data:");
    });

    test("skips postgres when DATABASE_URL is present", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "local");

      const result = generator.generateLocal({
        project: "myapp",
        env: "local",
        naming: namingCtx,
        apps: [
          makeApp({
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: { DATABASE_URL: "postgresql://..." },
      });

      // Only resource was postgres which is skipped → null
      expect(result).toBeNull();
    });

    test("generates redis service when app has KV", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "local");

      const result = generator.generateLocal({
        project: "myapp",
        env: "local",
        naming: namingCtx,
        apps: [
          makeApp({
            resources: {
              hasDatabase: false,
              hasBucket: false,
              hasKV: true,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: {},
      });

      expect(result).toContain("redis:");
      expect(result).toContain("image: redis:7-alpine");
      expect(result).toContain("6379:6379");
    });

    test("skips redis when REDIS_URL is present", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "local");

      const result = generator.generateLocal({
        project: "myapp",
        env: "local",
        naming: namingCtx,
        apps: [
          makeApp({
            resources: {
              hasDatabase: false,
              hasBucket: false,
              hasKV: true,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: { REDIS_URL: "redis://..." },
      });

      // Only resource was redis which is skipped → null
      expect(result).toBeNull();
    });

    test("generates rustfs service when app has bucket and no S3_ENDPOINT", ({
      expect,
    }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "local");

      const result = generator.generateLocal({
        project: "myapp",
        env: "local",
        naming: namingCtx,
        apps: [
          makeApp({
            resources: {
              hasDatabase: false,
              hasBucket: true,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: {},
      });

      expect(result).toContain("rustfs:");
      expect(result).toContain("image: rustfs/rustfs:latest");
      expect(result).toContain("9000:9000");
      expect(result).toContain("RUSTFS_ROOT_USER: alepha");
      expect(result).toContain("rustfs_data:");
    });

    test("skips rustfs when S3_ENDPOINT is present", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "local");

      const result = generator.generateLocal({
        project: "myapp",
        env: "local",
        naming: namingCtx,
        apps: [
          makeApp({
            resources: {
              hasDatabase: false,
              hasBucket: true,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: { S3_ENDPOINT: "https://xxx.r2.cloudflarestorage.com" },
      });

      expect(result).toBeNull();
    });

    test("returns null when no services needed", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "local");

      const result = generator.generateLocal({
        project: "myapp",
        env: "local",
        naming: namingCtx,
        apps: [makeApp()],
        envVars: {},
      });

      expect(result).toBeNull();
    });
  });

  describe("generateRemote", () => {
    test("generates app with traefik labels when domain is set", ({
      expect,
    }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "production");

      const result = generator.generateRemote({
        project: "myapp",
        env: "production",
        naming: namingCtx,
        domain: "myapp.com",
        apps: [
          makeApp({
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: {},
      });

      // No traefik service in project compose
      expect(result).not.toContain("image: traefik");
      expect(result).not.toContain("container_name: alepha-traefik");
      // App has traefik labels
      expect(result).toContain("app:");
      expect(result).toContain("Host(`myapp.com`)");
      expect(result).toContain("certresolver=letsencrypt");
      // Connects to shared network
      expect(result).toContain("alepha-proxy");
      expect(result).toContain("external: true");
      // Has postgres
      expect(result).toContain("postgres:");
    });

    test("skips traefik labels and exposes port directly when no domain", ({
      expect,
    }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "staging");

      const result = generator.generateRemote({
        project: "myapp",
        env: "staging",
        naming: namingCtx,
        apps: [
          makeApp({
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: {},
      });

      expect(result).not.toContain("traefik");
      expect(result).not.toContain("alepha-proxy");
      expect(result).toContain("app:");
      expect(result).toContain("3000:3000");
      expect(result).toContain("postgres:");
    });

    test("skips postgres when DATABASE_URL present", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "production");

      const result = generator.generateRemote({
        project: "myapp",
        env: "production",
        naming: namingCtx,
        domain: "myapp.com",
        apps: [
          makeApp({
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: { DATABASE_URL: "postgresql://external:5432/db" },
      });

      expect(result).toContain("app:");
      expect(result).not.toContain("postgres:");
    });

    test("multi-app uses convention subdomain from domain", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myproject", "production");

      const result = generator.generateRemote({
        project: "myproject",
        env: "production",
        naming: namingCtx,
        domain: "company.com",
        apps: [makeApp({ name: "api" }), makeApp({ name: "admin" })],
        envVars: {},
      });

      expect(result).toContain("app-api:");
      expect(result).toContain("Host(`api.company.com`)");
      expect(result).toContain("app-admin:");
      expect(result).toContain("Host(`admin.company.com`)");
    });

    test("multi-app domains override takes precedence over convention", ({
      expect,
    }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myproject", "production");

      const result = generator.generateRemote({
        project: "myproject",
        env: "production",
        naming: namingCtx,
        domain: "company.com",
        domains: { shop: "myshop.com" },
        apps: [
          makeApp({ name: "api" }),
          makeApp({ name: "admin" }),
          makeApp({ name: "shop" }),
        ],
        envVars: {},
      });

      expect(result).toContain("Host(`api.company.com`)");
      expect(result).toContain("Host(`admin.company.com`)");
      expect(result).toContain("Host(`myshop.com`)");
    });

    test("generates rustfs service when app has bucket", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "production");

      const result = generator.generateRemote({
        project: "myapp",
        env: "production",
        naming: namingCtx,
        domain: "myapp.com",
        apps: [
          makeApp({
            resources: {
              hasDatabase: false,
              hasBucket: true,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: {},
      });

      expect(result).toContain("rustfs:");
      expect(result).toContain("image: rustfs/rustfs:latest");
      expect(result).toContain("RUSTFS_ROOT_PASSWORD: ${S3_SECRET_KEY}");
      expect(result).toContain("rustfs_data:");
      expect(result).toContain("depends_on:");
      expect(result).toContain("- rustfs");
      // RustFS on internal network when domain is set
      expect(result).toContain("internal");
    });

    test("skips rustfs when S3_ENDPOINT present", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myapp", "production");

      const result = generator.generateRemote({
        project: "myapp",
        env: "production",
        naming: namingCtx,
        domain: "myapp.com",
        apps: [
          makeApp({
            resources: {
              hasDatabase: false,
              hasBucket: true,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          }),
        ],
        envVars: { S3_ENDPOINT: "https://xxx.r2.cloudflarestorage.com" },
      });

      expect(result).not.toContain("rustfs:");
    });

    test("multi-app without domain exposes incremental ports", ({ expect }) => {
      const { generator, naming } = createTestEnv();
      const namingCtx = naming.forContext("myproject", "staging");

      const result = generator.generateRemote({
        project: "myproject",
        env: "staging",
        naming: namingCtx,
        apps: [makeApp({ name: "api" }), makeApp({ name: "admin" })],
        envVars: {},
      });

      expect(result).toContain("3000:3000");
      expect(result).toContain("3001:3000");
      expect(result).not.toContain("traefik");
    });
  });

  describe("resolveAppDomain", () => {
    test("returns domains override when present", ({ expect }) => {
      const { generator } = createTestEnv();
      const result = generator.resolveAppDomain("shop", true, "company.com", {
        shop: "myshop.com",
      });
      expect(result).toBe("myshop.com");
    });

    test("returns subdomain convention for multi-app", ({ expect }) => {
      const { generator } = createTestEnv();
      const result = generator.resolveAppDomain(
        "api",
        true,
        "company.com",
        undefined,
      );
      expect(result).toBe("api.company.com");
    });

    test("returns domain directly for single-app", ({ expect }) => {
      const { generator } = createTestEnv();
      const result = generator.resolveAppDomain(
        "api",
        false,
        "myapp.com",
        undefined,
      );
      expect(result).toBe("myapp.com");
    });

    test("returns undefined when no domain", ({ expect }) => {
      const { generator } = createTestEnv();
      const result = generator.resolveAppDomain(
        "api",
        false,
        undefined,
        undefined,
      );
      expect(result).toBeUndefined();
    });
  });
});
