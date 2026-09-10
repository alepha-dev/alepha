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
    /**
     * Called before each batch answers, so a test can make one fail or make
     * several overlap. The upload is the only call worth driving that way.
     */
    beforeUpload?: (index: number) => Promise<void>,
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
            create: (async (params: unknown, options?: unknown) => {
              calls.push({ name: "assets.upload", args: [params, options] });
              const index = uploads++;
              await beforeUpload?.(index);
              const jwt = uploadJwts[index];
              return jwt ? { jwt } : {};
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
      queues: {
        consumers: {
          create: record("consumers.create") as never,
          list: record("consumers.list", { result: [] }) as never,
          update: record("consumers.update") as never,
        },
      },
    };

    const client = new CloudflareDeployClient({
      apiToken: "estate-token",
      accountId: "estate-account",
      client: api,
      // A fixed clock, so the session-deadline case is a decision rather than
      // a race with the wall.
      now: () => 1_000_000,
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
      ).toThrow(/operator's own account/);
      expect(
        () => new CloudflareDeployClient({ apiToken: "t", accountId: "" }),
      ).toThrow(/estate's account id/);
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

    it("sends the server's buckets as its own, never merged", async ({
      expect,
    }) => {
      // Cloudflare answers a grouping; wrangler uploads it unchanged. Merging
      // two buckets into one request replaces the server's answer with a
      // guess, which is what this used to do.
      const three: Record<string, CloudflareAssetEntry> = {
        "/a.js": { hash: "aa", size: 4 },
        "/b.js": { hash: "bb", size: 4 },
        "/c.js": { hash: "cc", size: 4 },
      };
      const { client, of } = fake(
        { jwt: "session", buckets: [["aa", "bb"], ["cc"]] },
        [undefined, "completion"],
      );

      await client.uploadAssets("my-app-staging", {
        manifest: three,
        read,
      });

      const sent = of("assets.upload").map((call) =>
        Object.keys((call.args[0] as { body: Record<string, File> }).body),
      );
      // Two requests, matching the two buckets - not one request of three.
      expect(sent).toEqual([["aa", "bb"], ["cc"]]);
    });

    it("retries a batch that fails, rather than losing the deploy", async ({
      expect,
    }) => {
      // wrangler's ladder, and its numbers: five attempts with an exponential
      // wait. An asset upload that fails once is ordinary, and a deploy that
      // gives up on the first one turns a blip into a red run.
      let failures = 0;
      const { client, of } = fake(
        { jwt: "session", buckets: [["bbbb"]] },
        [undefined, "completion"],
        [],
        "acme",
        async () => {
          if (failures++ === 0) {
            throw new Error("503 from the edge");
          }
        },
      );

      const answer = await client.uploadAssets("my-app-staging", {
        manifest,
        read,
      });

      expect(answer).toEqual({ jwt: "completion" });
      expect(of("assets.upload")).toHaveLength(2);
    });

    it("keeps several batches in flight, up to wrangler's limit", async ({
      expect,
    }) => {
      // Sequential uploads make a thousand-file site a thousand round trips
      // end to end. Three at a time is `BULK_UPLOAD_CONCURRENCY`, taken
      // rather than invented.
      const many: Record<string, CloudflareAssetEntry> = {};
      for (let i = 0; i < 1000; i++) {
        many[`/f${i}.js`] = { hash: `h${i}`, size: 4 };
      }
      let live = 0;
      let peak = 0;
      const { client, of } = fake(
        { jwt: "session", buckets: [Object.values(many).map((it) => it.hash)] },
        [undefined, undefined, undefined, undefined, "completion"],
        [],
        "acme",
        async () => {
          live++;
          peak = Math.max(peak, live);
          await new Promise((resolve) => setTimeout(resolve, 5));
          live--;
        },
      );

      await client.uploadAssets("my-app-staging", {
        manifest: many,
        read,
        readAll: async (keys, onFile) => {
          for (const key of keys) await onFile(key, bytes("abcd"));
        },
      });

      // 1000 files against the 200-file cap is five batches.
      expect(of("assets.upload")).toHaveLength(5);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(3);
    });

    /**
     * ⚠️ **The upload token is a real JWT and it carries instructions.**
     * Undocumented, and wrangler reads both of them: `exp` is a hard deadline
     * on the whole upload, and `wrangler_single_asset_uploads` asks for a
     * different transport entirely.
     */
    describe("what the session token says", () => {
      const token = (payload: Record<string, unknown>) =>
        `x.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.y`;

      it("refuses a session that wants single-asset uploads", async ({
        expect,
      }) => {
        // That mode is one request per file against a different path, with
        // the bytes raw and the type as a request header. Sending it
        // multipart anyway is a wrong protocol failing namelessly, which is
        // the exact shape this file keeps paying for.
        const { client } = fake(
          {
            jwt: token({ wrangler_single_asset_uploads: true }),
            buckets: [["bbbb"]],
          },
          ["completion"],
        );

        await expect(
          client.uploadAssets("my-app-staging", { manifest, read }),
        ).rejects.toThrow(/single-asset uploads/);
      });

      it("says an expired session kept what it already took", async ({
        expect,
      }) => {
        // The difference between "start again" and "run it again, it will be
        // quick" - Cloudflare holds every accepted upload, so the next
        // session asks only for what is still missing.
        // `exp` is in seconds, and the fake clock reads 1_000_000 ms, so a
        // token expiring at second 1 is long past.
        const { client } = fake(
          { jwt: token({ exp: 1 }), buckets: [["bbbb"]] },
          ["completion"],
        );

        await expect(
          client.uploadAssets("my-app-staging", { manifest, read }),
        ).rejects.toThrow(/keeps what was already uploaded/);
      });

      it("uploads normally when the token says nothing it understands", async ({
        expect,
      }) => {
        // A token this cannot parse is still one the API may accept, so an
        // unreadable payload costs the deadline and the mode, never the
        // deploy.
        const { client, of } = fake({ jwt: "not-a-jwt", buckets: [["bbbb"]] }, [
          "completion",
        ]);

        await expect(
          client.uploadAssets("my-app-staging", { manifest, read }),
        ).resolves.toEqual({ jwt: "completion" });
        expect(of("assets.upload")).toHaveLength(1);
      });
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
      ).rejects.toThrow(/not in the manifest we sent/);
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

    /**
     * ⚠️ **Every deploy step has to survive running twice**, because a deploy
     * is a `$job` and a retried or rescheduled execution replays it
     * (`DeployJobs`). The consumer was the one step that is a bare CREATE:
     * the script, the crons and the domain are PUTs and the assets dedup by
     * hash. So the replay of any deploy that binds a consumer would find the
     * one the first run bound, be refused for it, and report a failure for a
     * Worker that was already live.
     */
    describe("a redeploy", () => {
      /**
       * Cloudflare's consumers resource, with state. A second create for the
       * same Worker is refused, which is the failure a replayed deploy hit.
       *
       * The store is canonical and the list PRESENTS the script under a
       * configurable field, because the sources disagree on its name: the
       * API reference and the SDK say `script_name`, wrangler reads `script`,
       * and this repo's own `CloudflareApi` reads `service`.
       */
      const queueApi = (
        seeded: Array<{
          id: string;
          script: string;
          settings?: Record<string, unknown>;
          deadLetterQueue?: string;
        }> = [],
        scriptField: "script_name" | "script" | "service" = "script_name",
      ) => {
        const rows = seeded.map((it) => ({ queueId: "q1", ...it }));
        let created = 0;
        const api = {
          queues: {
            consumers: {
              list: async (queueId: string) => ({
                result: rows
                  .filter((it) => it.queueId === queueId)
                  .map((it) => ({
                    consumer_id: it.id,
                    type: "worker",
                    [scriptField]: it.script,
                    settings: it.settings,
                    dead_letter_queue: it.deadLetterQueue ?? "",
                  })),
              }),
              create: async (
                queueId: string,
                params: {
                  script_name: string;
                  settings?: Record<string, unknown>;
                  dead_letter_queue?: string;
                },
              ) => {
                if (
                  rows.some(
                    (it) =>
                      it.queueId === queueId &&
                      it.script === params.script_name,
                  )
                ) {
                  throw new Error(
                    `queue ${queueId} already has a consumer for ${params.script_name}`,
                  );
                }
                rows.push({
                  queueId,
                  id: `c${++created}`,
                  script: params.script_name,
                  settings: params.settings,
                  deadLetterQueue: params.dead_letter_queue,
                });
                return {};
              },
              update: async (
                consumerId: string,
                params: {
                  queue_id: string;
                  script_name: string;
                  settings?: Record<string, unknown>;
                  dead_letter_queue?: string;
                },
              ) => {
                const row = rows.find(
                  (it) =>
                    it.id === consumerId && it.queueId === params.queue_id,
                );
                if (!row) {
                  throw new Error(`no consumer ${consumerId}`);
                }
                Object.assign(row, {
                  script: params.script_name,
                  settings: params.settings,
                  deadLetterQueue: params.dead_letter_queue,
                });
                return {};
              },
            },
          },
        };
        const client = new CloudflareDeployClient({
          apiToken: "estate-token",
          accountId: "estate-account",
          client: api as unknown as CloudflareDeployApi,
        });
        return { client, rows };
      };

      it("does not fail on the consumer a previous deploy bound", async ({
        expect,
      }) => {
        const { client, rows } = queueApi();
        const consumers = plan({
          queueConsumers: [
            {
              queueId: "q1",
              settings: { batch_size: 1, max_retries: 3 },
              deadLetterQueue: "jobs-dlq",
            },
          ],
        }) as never;

        await client.putQueueConsumers(consumers);
        await client.putQueueConsumers(consumers);

        expect(rows.map((it) => it.script)).toEqual(["my-app-staging"]);
      });

      /**
       * Update rather than skip, because a skip would freeze a consumer at
       * whatever the FIRST deploy declared. `max_batch_size: 1` is the case
       * in point: added after Lore's job queue was already bound, it reaches
       * the live consumer only if a redeploy writes it.
       */
      it("gives the consumer it finds this deploy's settings", async ({
        expect,
      }) => {
        const { client, rows } = queueApi([
          {
            id: "c-old",
            script: "my-app-staging",
            settings: { batch_size: 10, max_wait_time_ms: 5000 },
          },
        ]);

        await client.putQueueConsumers(
          plan({
            queueConsumers: [
              {
                queueId: "q1",
                settings: { batch_size: 1, max_retries: 3 },
                deadLetterQueue: "jobs-dlq",
              },
            ],
          }) as never,
        );

        expect(rows).toEqual([
          {
            queueId: "q1",
            id: "c-old",
            script: "my-app-staging",
            settings: { batch_size: 1, max_retries: 3 },
            deadLetterQueue: "jobs-dlq",
          },
        ]);
      });

      it.for(["script_name", "script", "service"] as const)(
        "recognises its consumer when the API names the script `%s`",
        async (scriptField, { expect }) => {
          const { client, rows } = queueApi(
            [{ id: "c-old", script: "my-app-staging" }],
            scriptField,
          );

          await client.putQueueConsumers(
            plan({
              queueConsumers: [{ queueId: "q1", settings: { batch_size: 1 } }],
            }) as never,
          );

          expect(rows.map((it) => it.id)).toEqual(["c-old"]);
          expect(rows[0]?.settings).toEqual({ batch_size: 1 });
        },
      );

      /**
       * Matched by script, never "the queue's consumer". An update names the
       * script it binds, so re-pointing another Worker's consumer at this one
       * would silently take that Worker's messages away from it.
       */
      it("never takes over a consumer another Worker holds", async ({
        expect,
      }) => {
        const { client, rows } = queueApi([
          {
            id: "c-other",
            script: "other-worker",
            settings: { batch_size: 5 },
          },
        ]);

        await client.putQueueConsumers(
          plan({
            queueConsumers: [{ queueId: "q1", settings: { batch_size: 1 } }],
          }) as never,
        );

        expect(rows.find((it) => it.id === "c-other")).toMatchObject({
          script: "other-worker",
          settings: { batch_size: 5 },
        });
        expect(rows.map((it) => it.script).sort()).toEqual([
          "my-app-staging",
          "other-worker",
        ]);
      });

      /**
       * ⚠️ Every fake above is shaped by `CloudflareDeployApi`, which is
       * written by hand, so none of them can disagree with it. This one
       * drives the REAL SDK over a captured `fetch`: the list has to answer a
       * page whose `result` is the array, and the update has to carry the
       * queue in its path rather than its body. `versions.list` is the
       * precedent for a hand-typed shape that compiled, passed its fake, and
       * was wrong.
       */
      it("binds through the SDK's own consumer endpoints", async ({
        expect,
      }) => {
        const sent: Array<{ call: string; body?: unknown }> = [];
        const original = globalThis.fetch;
        globalThis.fetch = (async (
          input: RequestInfo | URL,
          init: RequestInit = {},
        ) => {
          const method = init.method ?? "GET";
          const href =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          const url = href.replace("https://cf.test/client/v4", "");
          sent.push({
            call: `${method} ${url}`,
            body:
              typeof init.body === "string" ? JSON.parse(init.body) : undefined,
          });
          // `q-bound` already holds this Worker's consumer; `q-new` holds none.
          const result =
            method !== "GET"
              ? {}
              : url.includes("/q-bound/")
                ? [
                    {
                      consumer_id: "c1",
                      type: "worker",
                      script_name: "my-app-staging",
                    },
                  ]
                : [];
          return new Response(
            JSON.stringify({ success: true, errors: [], messages: [], result }),
            { headers: { "content-type": "application/json" } },
          );
        }) as typeof globalThis.fetch;

        try {
          const client = new CloudflareDeployClient({
            apiToken: "estate-token",
            accountId: "estate-account",
            baseURL: "https://cf.test/client/v4",
          });
          await client.putQueueConsumers(
            plan({
              queueConsumers: [
                {
                  queueId: "q-bound",
                  settings: { batch_size: 1 },
                  deadLetterQueue: "jobs-dlq",
                },
                { queueId: "q-new", settings: { max_retries: 3 } },
              ],
            }) as never,
          );
        } finally {
          globalThis.fetch = original;
        }

        expect(sent).toEqual([
          { call: "GET /accounts/estate-account/queues/q-bound/consumers" },
          {
            call: "PUT /accounts/estate-account/queues/q-bound/consumers/c1",
            body: {
              type: "worker",
              script_name: "my-app-staging",
              dead_letter_queue: "jobs-dlq",
              settings: { batch_size: 1 },
            },
          },
          { call: "GET /accounts/estate-account/queues/q-new/consumers" },
          {
            call: "POST /accounts/estate-account/queues/q-new/consumers",
            body: {
              type: "worker",
              script_name: "my-app-staging",
              settings: { max_retries: 3 },
            },
          },
        ]);
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
