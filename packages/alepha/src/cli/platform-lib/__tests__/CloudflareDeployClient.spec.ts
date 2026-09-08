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
    // ⚠️ `null` and not `undefined` for "this account has none": passing
    // `undefined` explicitly to a parameter with a default gets the default,
    // which made the no-subdomain case silently assert the happy path.
    accountSubdomain: string | null = "acme",
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
            list: record("versions.list", {
              result: { items: versions },
            }) as never,
          },
          deployments: {
            create: record("deployments.create") as never,
          },
          subdomain: { create: record("subdomain.create") as never },
        },
        assets: {
          upload: {
            // ⚠️ Records the OPTIONS argument too, which the other fakes do
            // not need: this is the one call whose credential differs from the
            // client's own. See the test below.
            create: ((params: unknown, options?: unknown) => {
              calls.push({ name: "assets.upload", args: [params, options] });
              const jwt = uploadJwts[uploads++];
              return Promise.resolve(jwt ? { jwt } : {});
            }) as never,
          },
        },
        domains: { update: record("domains.update") as never },
        subdomains: {
          get: record("subdomains.get", {
            subdomain: accountSubdomain ?? undefined,
          }) as never,
        },
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
      const body = (upload.args[0] as { body: Record<string, File> }).body;
      // Keyed by hash, base64 of the bytes, and `aaaa` is absent because
      // Cloudflare already holds it.
      expect(Object.keys(body)).toEqual(["bbbb"]);
      expect(atob(await body.bbbb!.text())).toBe("bytes of /app.js");
    });

    /**
     * ⚠️ **The part's own `Content-Type` is what Cloudflare serves the asset
     * with**, and the SDK writes one only for a `Blob`: a plain string is
     * appended with none, so every asset comes back with an EMPTY content
     * type. The browser then refuses each module script and each stylesheet
     * under strict MIME checking.
     *
     * What makes it expensive to spot is that a prerendered site still looks
     * finished - the HTML is a file on disk, so the page paints and only the
     * JavaScript is missing. Measured on `ui.alepha.dev`, where it read as a
     * successful deploy until the console was opened.
     */
    it("types each part, so the browser will execute what it gets", async ({
      expect,
    }) => {
      const { client, of } = fake(
        { jwt: "session", buckets: [["aaaa", "bbbb"]] },
        ["completion"],
      );

      await client.uploadAssets("my-app-staging", { manifest, read });

      const [upload] = of("assets.upload");
      const body = (upload.args[0] as { body: Record<string, File> }).body;
      expect(body.aaaa?.type).toBe("text/html; charset=utf-8");
      expect(body.bbbb?.type).toBe("text/javascript; charset=utf-8");
    });

    /**
     * ⚠️ **The path that lets a big site deploy at all.**
     *
     * `read` is a pull, and a pull needs every byte to be addressable, which
     * inside Lore's Worker meant the whole unpacked tree sitting in a
     * `MemoryFileSystemProvider`: `apps/docs` is 49 MB of assets against a
     * 128 MB isolate, and it died with `Worker exceeded memory limit` before
     * the upload started.
     *
     * Pushed instead, each file exists for one callback, joins the batch being
     * filled and is gone - so what is resident is one batch rather than a
     * site, whatever the site's size.
     */
    it("uploads as it is fed, so a batch is all that is ever resident", async ({
      expect,
    }) => {
      const many: Record<string, CloudflareAssetEntry> = {};
      for (let i = 0; i < 260; i++) {
        many[`/f${i}.js`] = { hash: `h${i}`, size: 4 };
      }
      const { client, of } = fake(
        { jwt: "session", buckets: [Object.values(many).map((it) => it.hash)] },
        [undefined, "completion"],
      );

      let live = 0;
      let peak = 0;
      const answer = await client.uploadAssets("my-app-staging", {
        manifest: many,
        read: async () => bytes("unused"),
        readAll: async (keys, onFile) => {
          for (const key of keys) {
            live++;
            peak = Math.max(peak, live);
            await onFile(key, bytes("abcd"));
            // The client copied what it needed; the source is free to drop it.
            live--;
          }
        },
      });

      expect(answer).toEqual({ jwt: "completion" });
      // 260 files against a 200-file cap is two batches, so the cap is what
      // bounds a batch rather than the byte budget these tiny files never
      // reach.
      expect(of("assets.upload")).toHaveLength(2);
      // One file is handed over at a time: the source never has to hold two.
      expect(peak).toBe(1);
      const [first] = of("assets.upload");
      const body = (first.args[0] as { body: Record<string, File> }).body;
      expect(Object.keys(body)).toHaveLength(200);
      expect(Object.values(body)[0]?.type).toBe(
        "text/javascript; charset=utf-8",
      );
    });

    /**
     * ⚠️ **The one call that does NOT use the account's API token**, and
     * getting it wrong is a flat `401 Unauthorized` from Cloudflare with
     * nothing naming the credential.
     *
     * The upload session answers a JWT scoped to that session, and the batch
     * endpoint authenticates with it. The client is constructed with the
     * estate's API token and sends it on every other call, so without an
     * override this batch goes out under the wrong credential entirely.
     *
     * It survived because nothing ever called `uploadAssets` against the real
     * API - `WorkerCloudflareAdapter` never set `plan.assets` - so this
     * function's only exercise was a fake that accepts whatever it is handed.
     * Measured on `ui.alepha.dev`, 2026-09-08.
     */
    it("authenticates each batch with the session token, not the account token", async ({
      expect,
    }) => {
      const { client, of } = fake({ jwt: "session", buckets: [["bbbb"]] }, [
        "completion",
      ]);

      await client.uploadAssets("my-app-staging", { manifest, read });

      const [upload] = of("assets.upload");
      const options = upload.args[1] as
        | { headers?: Record<string, string> }
        | undefined;
      expect(options?.headers?.authorization).toBe("Bearer session");
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

    it("names the account when the workers.dev call fails, without throwing", async ({
      expect,
    }) => {
      // The one call with no save-time probe behind it, so its failure has to
      // explain itself: an account that never registered a workers.dev
      // subdomain answers error 10007, which is a fact about the account and
      // not about the token, and a probe would have misread it as a missing
      // permission on a perfectly valid one.
      //
      // ⚠️ REPORTED, never thrown. By the time this runs the script is
      // uploaded and its resources exist, and since `enhanceDomain` now writes
      // `workers_dev` in both directions this call happens on every deploy -
      // so throwing would fail every deploy such an account ever made, after
      // the Worker was already live.
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

      const reason = await refusing.putSubdomain(
        plan({ workersDev: true }) as never,
      );
      expect(reason).toMatch(/never registered a workers.dev subdomain/);
    });

    it("says nothing when the subdomain was set", async ({ expect }) => {
      const { client, of } = fake();

      expect(
        await client.putSubdomain(plan({ workersDev: true }) as never),
      ).toBeUndefined();
      expect(of("subdomain.create")[0].args[1]).toMatchObject({
        enabled: true,
      });
    });

    describe("the account's own subdomain", () => {
      it("answers the label a workers.dev address is built from", async ({
        expect,
      }) => {
        const { client, of } = fake();

        expect(await client.getSubdomain()).toBe("acme");
        expect(of("subdomains.get")[0].args[0]).toMatchObject({
          account_id: "estate-account",
        });
      });

      it("answers undefined for an account that has none", async ({
        expect,
      }) => {
        const { client } = fake({}, [], [], null);

        expect(await client.getSubdomain()).toBeUndefined();
      });

      it("never throws: the deploy has already succeeded by then", async ({
        expect,
      }) => {
        const refusing = new CloudflareDeployClient({
          apiToken: "t",
          accountId: "a",
          client: {
            workers: {
              subdomains: {
                get: async () => {
                  throw new Error("workers.dev subdomain not found (10007)");
                },
              },
            },
          } as unknown as CloudflareDeployApi,
        });

        // The address is a convenience read after a successful upload. A
        // failure here must not retroactively fail a deploy that worked, so
        // `undefined` means "no address to show" whatever the reason.
        expect(await refusing.getSubdomain()).toBeUndefined();
      });
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
  describe("the version a deploy can roll back to", () => {
    /**
     * ⚠️ `PUT /workers/scripts/{name}` answers `{ startup_time_ms, id }` where
     * `id` is the SCRIPT NAME. There is no `version_id` in that shape, so
     * reading `version_id ?? id` stored `my-app-staging` as the version of
     * every successful deploy - which `RollbackService` compares against the
     * real version list, never matches, and silently falls back to redeploying
     * the artifact. Fast rollback could not work and nothing said so.
     */
    it("reads the version back rather than trusting the upload response", async ({
      expect,
    }) => {
      const { client } = fake(
        {},
        [],
        [
          { id: "v-new", created_on: "2026-09-07T10:00:00Z" },
          { id: "v-old", created_on: "2026-09-01T10:00:00Z" },
        ],
      );

      expect(await client.putScript(plan() as never)).toBe("v-new");
    });

    it("takes the newest, not the first the API happened to list", async ({
      expect,
    }) => {
      const { client } = fake(
        {},
        [],
        [
          { id: "v-old", created_on: "2026-09-01T10:00:00Z" },
          { id: "v-new", created_on: "2026-09-07T10:00:00Z" },
        ],
      );

      expect(await client.putScript(plan() as never)).toBe("v-new");
    });

    /**
     * ⚠️ The script is already live by the time this read runs. Throwing away
     * a Worker that deployed fine because a bookkeeping call failed would be
     * far worse than losing the fast path: `undefined` already means "this run
     * cannot be rolled back to".
     */
    it("answers undefined rather than failing a deploy that already shipped", async ({
      expect,
    }) => {
      const { client } = fake();
      Object.assign(client as unknown as Record<string, unknown>, {
        listVersions: async () => {
          throw new Error("Cloudflare timed out");
        },
      });

      expect(await client.putScript(plan() as never)).toBeUndefined();
    });
  });
});
