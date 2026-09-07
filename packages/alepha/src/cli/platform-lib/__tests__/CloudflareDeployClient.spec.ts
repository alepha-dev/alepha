import { describe, it } from "vitest";

import type { CloudflareAssetEntry } from "../services/CloudflareAssetManifest.ts";
import {
  type CloudflareDeployApi,
  CloudflareDeployClient,
} from "../services/CloudflareDeployClient.ts";

/**
 * The seven calls a Workers deploy is, driven against a recorded fake.
 *
 * ⚠️ Steps 4 to 7 are what a naive implementation drops silently: crons stop
 * firing, the custom domain never attaches, the queue consumer never binds, and
 * the deploy reports success. That is what most of this file is about.
 */
describe("the Cloudflare deploy client", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  const fake = (
    session: { jwt?: string; buckets?: string[][] } = {},
    uploadJwts: Array<string | undefined> = [],
    versions: Array<{ id: string; created_on?: string }> = [],
  ) => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const record =
      (name: string, answer: unknown = {}) =>
      (...args: unknown[]) => {
        calls.push({ name, args });
        return Promise.resolve(answer);
      };

    let uploads = 0;
    const api: CloudflareDeployApi = {
      put: record("script.put", { result: {} }) as never,
      workers: {
        scripts: {
          update: record("scripts.update") as never,
          assets: {
            upload: { create: record("assets.session", session) as never },
          },
          schedules: { update: record("schedules.update") as never },
          versions: {
            list: record("versions.list", { result: versions }) as never,
          },
          deployments: {
            create: record("deployments.create") as never,
          },
          subdomain: { create: record("subdomain.create") as never },
        },
        assets: {
          upload: {
            create: ((params: unknown) => {
              calls.push({ name: "assets.upload", args: [params] });
              const jwt = uploadJwts[uploads++];
              return Promise.resolve(jwt ? { jwt } : {});
            }) as never,
          },
        },
        domains: { update: record("domains.update") as never },
      },
      queues: { consumers: { create: record("consumers.create") as never } },
    };

    const client = new CloudflareDeployClient({
      apiToken: "estate-token",
      accountId: "estate-account",
      client: api,
    });

    return {
      client,
      calls,
      of: (name: string) => calls.filter((it) => it.name === name),
    };
  };

  const plan = (over: Record<string, unknown> = {}) => ({
    scriptName: "my-app-staging",
    mainModule: "index.js",
    modules: [{ name: "index.js", bytes: bytes("export default {};") }],
    ...over,
  });

  describe("the credential", () => {
    it("refuses to be built without a token or an account", ({ expect }) => {
      // ⚠️ The one thing that must never fall back to the environment.
      // `CLOUDFLARE_ACCOUNT_ID` inside Lore's Worker is Lore's OWN account, set
      // for Analytics Engine, so an empty credential defaulting from there
      // would deploy a user's artifact into the operator's account.
      expect(
        () => new CloudflareDeployClient({ apiToken: "", accountId: "acct" }),
      ).toThrowError(/operator's own account/);
      expect(
        () => new CloudflareDeployClient({ apiToken: "t", accountId: "" }),
      ).toThrowError(/estate's account id/);
    });

    it("sends the estate's account on every call", async ({ expect }) => {
      const { client, calls } = fake({ jwt: "session" });
      await client.deploy(
        plan({
          crons: ["0 * * * *"],
          domain: { hostname: "app.example.com" },
          workersDev: false,
          queueConsumers: [{ queueId: "q1" }],
        }) as never,
      );

      for (const call of calls) {
        if (call.name === "script.put") {
          // The raw upload carries the account in its path rather than in a
          // params object, so it is asserted separately below.
          expect(call.args[0], call.name).toContain(
            "/accounts/estate-account/",
          );
          continue;
        }
        const params = call.args.at(-1) as { account_id?: string };
        expect(params.account_id, call.name).toBe("estate-account");
      }
    });
  });

  describe("the assets", () => {
    const manifest: Record<string, CloudflareAssetEntry> = {
      "/index.html": { hash: "aaaa", size: 10 },
      "/app.js": { hash: "bbbb", size: 20 },
    };
    const read = async (key: string) => bytes(`bytes of ${key}`);

    it("uploads only what Cloudflare asks for", async ({ expect }) => {
      const { client, of } = fake({ jwt: "session", buckets: [["bbbb"]] }, [
        "completion",
      ]);

      const answer = await client.uploadAssets("my-app-staging", {
        manifest,
        read,
      });

      expect(answer).toEqual({ jwt: "completion" });
      const [upload] = of("assets.upload");
      const body = (upload.args[0] as { body: Record<string, string> }).body;
      // Keyed by hash, base64 of the bytes, and `aaaa` is absent because
      // Cloudflare already holds it.
      expect(Object.keys(body)).toEqual(["bbbb"]);
      expect(atob(body.bbbb as string)).toBe("bytes of /app.js");
    });

    it("uploads nothing when the set is unchanged", async ({ expect }) => {
      // A session with no buckets is Cloudflare saying it holds every hash,
      // which is what makes a redeploy or a rollback upload zero files.
      const { client, of } = fake({ jwt: "session", buckets: [] });

      const answer = await client.uploadAssets("my-app-staging", {
        manifest,
        read,
      });

      expect(answer).toEqual({ jwt: "session" });
      expect(of("assets.upload")).toHaveLength(0);
    });

    it("splits the upload into batches the isolate can hold", async ({
      expect,
    }) => {
      // ⚠️ Memory is the ceiling, not time. wrangler's own bucket cap is 98 MB
      // against a 128 MB isolate that is also holding the script, so the
      // batching is ours and not the server's.
      const many: Record<string, CloudflareAssetEntry> = {};
      const wanted: string[] = [];
      for (let i = 0; i < 400; i++) {
        const hash = `h${i}`;
        many[`/f${i}.txt`] = { hash, size: 32 };
        wanted.push(hash);
      }
      const { client, of } = fake({ jwt: "s", buckets: [wanted] }, [
        undefined,
        "completion",
      ]);

      const answer = await client.uploadAssets("my-app-staging", {
        manifest: many,
        read: async () => bytes("x"),
      });

      // 400 files against a 200-file cap.
      expect(of("assets.upload")).toHaveLength(2);
      // The completion token is the last non-empty one, not the first.
      expect(answer).toEqual({ jwt: "completion" });
    });

    it("refuses a hash it never sent", async ({ expect }) => {
      const { client } = fake({ jwt: "s", buckets: [["never-sent"]] });

      await expect(
        client.uploadAssets("my-app-staging", { manifest, read }),
      ).rejects.toThrowError(/not in the manifest we sent/);
    });
  });

  describe("the script upload", () => {
    it("sends strict inheritance and the assets jwt", async ({ expect }) => {
      const { client, of } = fake();

      await client.putScript(
        plan({
          assets: { manifest: {}, read: async () => bytes("") },
        }) as never,
        {
          jwt: "completion",
        },
      );

      const options = of("script.put")[0].args[1] as {
        query?: { bindings_inherit?: string };
      };
      // An unresolvable `inherit` binding fails the upload instead of silently
      // blanking a secret.
      expect(options.query?.bindings_inherit).toBe("strict");
      const metadata = await metadataOf(of("script.put")[0]);
      expect(metadata.assets?.jwt).toBe("completion");
      expect(metadata.assets?.keep_assets).toBeUndefined();
    });

    it("asks to keep the assets when nothing was uploaded", async ({
      expect,
    }) => {
      const { client, of } = fake();

      await client.putScript(
        plan({
          assets: { manifest: {}, read: async () => bytes("") },
        }) as never,
        undefined,
      );

      const metadata = await metadataOf(of("script.put")[0]);
      expect(metadata.assets?.keep_assets).toBe(true);
    });

    it("carries the secrets as secret_text bindings in the same call", async ({
      expect,
    }) => {
      // ⚠️ One upload, so the roughly 6 s window in which a new build ran
      // against the PREVIOUS secret set does not exist. There is no second
      // upload path and no `wrangler secret put` ordering to reproduce.
      const { client, of } = fake();

      await client.putScript(
        plan({
          bindings: [{ type: "d1", name: "DB", id: "db-1" }],
          secrets: { APP_SECRET: "s3cret" },
        }) as never,
      );

      const metadata = await metadataOf(of("script.put")[0]);
      expect(metadata.bindings).toEqual([
        { type: "d1", name: "DB", id: "db-1" },
        { type: "secret_text", name: "APP_SECRET", text: "s3cret" },
      ]);
    });
  });

  describe("what a naive implementation drops", () => {
    it("clears the crons when a deploy stops declaring any", async ({
      expect,
    }) => {
      // An empty array is NOT the same as `undefined`: skipping the call would
      // leave the previous schedule firing against new code.
      const { client, of } = fake();
      await client.putSchedules(plan({ crons: [] }) as never);

      expect(of("schedules.update")).toHaveLength(1);
      expect(
        (of("schedules.update")[0].args[1] as { body: unknown }).body,
      ).toEqual([]);
    });

    it("leaves the crons alone when the plan names none", async ({
      expect,
    }) => {
      const { client, of } = fake();
      await client.putSchedules(plan() as never);

      expect(of("schedules.update")).toHaveLength(0);
    });

    it("attaches the custom domain through the account-level call", async ({
      expect,
    }) => {
      // ⚠️ `workers.domains.update` and never `workers.routes.create`: the
      // first is account-level and covered by the estate's `workers` probe,
      // the second is zone-scoped and no estate can probe a zone it does not
      // know. Wildcard hosts went away with the owner's 2026-09-06 ruling.
      const { client, of } = fake();
      await client.putDomain(
        plan({ domain: { hostname: "app.example.com" } }) as never,
      );

      expect(of("domains.update")[0].args[0]).toMatchObject({
        hostname: "app.example.com",
        service: "my-app-staging",
      });
    });

    it("names the account when the workers.dev call fails", async ({
      expect,
    }) => {
      // The one call with no save-time probe behind it, so its failure has to
      // explain itself: an account that never registered a workers.dev
      // subdomain answers error 10007, which is a fact about the account and
      // not about the token, and a probe would have misread it as a missing
      // permission on a perfectly valid one.
      const refusing = new CloudflareDeployClient({
        apiToken: "t",
        accountId: "a",
        client: {
          workers: {
            scripts: {
              subdomain: {
                create: async () => {
                  throw new Error("workers.dev subdomain not found (10007)");
                },
              },
            },
          },
        } as unknown as CloudflareDeployApi,
      });

      await expect(
        refusing.putSubdomain(plan({ workersDev: true }) as never),
      ).rejects.toThrowError(/never registered a workers.dev subdomain/);
    });

    it("binds every queue consumer to this script", async ({ expect }) => {
      const { client, of } = fake();
      await client.putQueueConsumers(
        plan({
          queueConsumers: [
            { queueId: "q1", settings: { batch_size: 10 } },
            { queueId: "q2" },
          ],
        }) as never,
      );

      expect(of("consumers.create")).toHaveLength(2);
      expect(of("consumers.create")[0].args[0]).toBe("q1");
      expect(of("consumers.create")[0].args[1]).toMatchObject({
        type: "worker",
        script_name: "my-app-staging",
      });
    });
  });
  describe("rolling back", () => {
    it("lists the versions Cloudflare still holds", async ({ expect }) => {
      // ⚠️ What decouples rollback from retention: without it, `latest`-only
      // retention would leave nothing to roll back to and the fast path would
      // need a keep-N policy plus a GC job.
      const { client, of } = fake(
        {},
        [],
        [
          { id: "v2", created_on: "2026-09-07T10:00:00Z" },
          { id: "v1", created_on: "2026-09-06T10:00:00Z" },
        ],
      );

      const versions = await client.listVersions("my-app-staging");

      expect(versions.map((it) => it.id)).toEqual(["v2", "v1"]);
      expect(of("versions.list")[0].args[1]).toMatchObject({
        account_id: "estate-account",
      });
    });

    it("points the whole deployment at one version", async ({ expect }) => {
      const { client, of } = fake();

      await client.rollbackTo("my-app-staging", "v1", "rolled back by Lore");

      expect(of("deployments.create")[0].args[1]).toMatchObject({
        strategy: "percentage",
        versions: [{ version_id: "v1", percentage: 100 }],
        annotations: { "workers/message": "rolled back by Lore" },
      });
    });

    it("does not force past a boundary Cloudflare refuses", async ({
      expect,
    }) => {
      // Cloudflare blocks a rollback across a change it considers unsafe - a
      // secret that has since changed, a Durable Object migration a version
      // cannot be rolled past. Forcing past that is an operator's decision with
      // a warning in front of them, not this method's default.
      const { client, of } = fake();

      await client.rollbackTo("my-app-staging", "v1");

      expect("force" in (of("deployments.create")[0].args[1] as object)).toBe(
        false,
      );
    });
  });
  /**
   * The `metadata` part, parsed back out of the multipart body.
   */
  const metadataOf = async (call: { args: unknown[] }) => {
    const options = call.args[1] as { body: FormData };
    const part = options.body.get("metadata") as File;
    return JSON.parse(await part.text()) as {
      main_module?: string;
      bindings?: Array<Record<string, unknown>>;
      assets?: { jwt?: string; keep_assets?: boolean };
    };
  };

  describe("the upload the SDK cannot express", () => {
    /**
     * ⚠️ `cloudflare@7`'s `workers.scripts.update` hardcodes `Content-Type:
     * application/javascript` on a body it builds as multipart. Cloudflare
     * believes the header, reads the envelope as a classic service-worker
     * script, and answers a syntax error at `worker.js:1:2` - the `--` that
     * opens the first boundary. Nulling the header is what lets the form's own
     * boundary be sent.
     */
    it("lets the form set the content type instead of the SDK's default", async ({
      expect,
    }) => {
      const { client, of } = fake();

      await client.putScript(plan() as never);

      const options = of("script.put")[0].args[1] as {
        headers: Record<string, string | null>;
        body: FormData;
      };
      expect(options.headers["Content-Type"]).toBeNull();
      expect(options.body).toBeInstanceOf(FormData);
    });

    /**
     * ⚠️ The SDK's `getName` basenames every part (`.split(/[\\/]/).pop()`),
     * so `server/chunk.js` would upload as `chunk.js` while the entry still
     * imports `./server/chunk.js`. Every build with a chunk directory is
     * affected, which is every non-trivial build.
     */
    it("keeps a module's directory in its part name", async ({ expect }) => {
      const { client, of } = fake();

      await client.putScript(
        plan({
          mainModule: "main.cloudflare.js",
          modules: [
            { name: "main.cloudflare.js", bytes: bytes("export default {};") },
            { name: "server/chunk.js", bytes: bytes("export const a = 1;") },
          ],
        }) as never,
      );

      const body = (of("script.put")[0].args[1] as { body: FormData }).body;
      expect([...body.keys()]).toEqual([
        "metadata",
        "main.cloudflare.js",
        "server/chunk.js",
      ]);
      const chunk = body.get("server/chunk.js") as File;
      expect(chunk.name).toBe("server/chunk.js");
      expect(await chunk.text()).toBe("export const a = 1;");
    });

    it("names the entry in the metadata part", async ({ expect }) => {
      const { client, of } = fake();

      await client.putScript(plan({ mainModule: "index.js" }) as never);

      expect((await metadataOf(of("script.put")[0])).main_module).toBe(
        "index.js",
      );
    });
  });
});
