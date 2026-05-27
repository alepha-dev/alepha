import { t } from "alepha";
import { defineConfig } from "alepha/cli/config";
import { $command } from "alepha/command";

export default defineConfig({
  build: {
    docker: {
      // `wrangler` is the only runtime binary the image needs.
      // `CloudflareAdapter` shells out to it for `wrangler deploy` and
      // `wrangler d1 migrations apply --remote`. The REST-only port is
      // a v2 follow-up; until then wrangler is non-optional.
      //
      // `alepha` is NOT installed — Rocket library-embeds the
      // `PlatformOrchestrator` from `alepha/cli/platform-lib` (bundled
      // into the image's own dist/) and calls `orchestrator.up()`
      // in-process, so there's no `npx alepha …` spawn from the
      // workspace and therefore no need for `alepha` to be resolvable
      // at workspace cwd.
      install: ["wrangler"],
      image: {
        // `--image` alone → `alepha/rocket:latest`,
        // `--image=0.21.1` → `alepha/rocket:0.21.1`,
        // `--image=ghcr.io/foo/bar:v1` → fully overridden.
        tag: "alepha/rocket",
        // Auto-add org.opencontainers.image.{revision,created,version}
        // labels (git sha + tag + build timestamp).
        oci: true,
        // Always cross-build for linux/amd64 so the image is portable
        // to Cloudflare Containers regardless of publisher CPU.
        args: "--platform linux/amd64",
      },
    },
  },
  plugins: [
    () => ({
      // -------------------------------------------------------------------------
      // Run locally — credentials come from your `docker login` session.
      //
      //   yarn workspace rocket push                # → alepha/rocket:latest
      //   yarn workspace rocket push --tag 0.21.1   # → alepha/rocket:0.21.1
      //   yarn workspace rocket push --push=false   # build only
      // -------------------------------------------------------------------------
      push: $command({
        description:
          "Build the Alepha Rocket Docker image and push it to a registry. " +
          "Run locally — credentials come from the host `docker login` session.",
        flags: t.object({
          tag: t.optional(
            t.text({
              description:
                "Image tag (default: `latest`). Pass a version like `0.21.1` to publish a pinned image.",
            }),
          ),
          dryRun: t.optional(
            t.boolean({
              aliases: ["dry-run"],
              description:
                "Build the image only; skip `docker push`. Useful for testing the Dockerfile locally.",
            }),
          ),
        }),
        handler: async ({ run, flags }) => {
          const tag = flags.tag ?? "latest";
          const shouldPush = !flags.dryRun;
          const image = `alepha/rocket:${tag}`;

          // `alepha build --target=docker --image=<full>` generates the
          // Dockerfile + tagged image in one step. The `install:` field
          // above injects the `RUN npm install --global wrangler alepha`
          // line.
          await run(`yarn alepha build --target=docker --image=${image}`);

          if (shouldPush) {
            await run(`docker push ${image}`);
          }
        },
      }),
    }),
  ],
});
