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
        // The image is consumed by Cloudflare Containers, which only
        // pulls from `registry.cloudflare.com/<account-id>/<name>:<tag>`
        // (DockerHub/GHCR are rejected with
        // `IMAGE_REGISTRY_DOESNT_CONTAIN_IMAGE`). The local docker tag
        // is just `alepha-rocket` — `wrangler containers push` retags
        // it to the CF managed registry at push time.
        tag: "alepha-rocket",
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
      // Push to the Cloudflare managed registry. CLOUDFLARE_API_TOKEN
      // (with `Workers Containers: Edit`) + CLOUDFLARE_ACCOUNT_ID must
      // be set in the environment — wrangler reads both.
      //
      //   yarn workspace rocket push --tag 0.1.0      # → registry.cloudflare.com/<account>/alepha-rocket:0.1.0
      //   yarn workspace rocket push --tag 0.1.0 --dry-run   # build only, no push
      //
      // CF Containers rejects `:latest`; always pass a real tag.
      // -------------------------------------------------------------------------
      push: $command({
        description:
          "Build the Alepha Rocket Docker image and push it to the Cloudflare managed registry. " +
          "Requires CLOUDFLARE_API_TOKEN (Workers Containers: Edit) + CLOUDFLARE_ACCOUNT_ID in env.",
        flags: t.object({
          tag: t.optional(
            t.text({
              description:
                "Image tag — CF Containers rejects `latest`, so pass a real version like `0.1.0`.",
            }),
          ),
          dryRun: t.optional(
            t.boolean({
              aliases: ["dry-run"],
              description:
                "Build the image only; skip `wrangler containers push`. Useful for testing the Dockerfile locally.",
            }),
          ),
        }),
        handler: async ({ run, flags }) => {
          const tag = flags.tag ?? "latest";
          const shouldPush = !flags.dryRun;
          const image = `alepha-rocket:${tag}`;

          // `alepha build --target=docker --image=<local-tag>` generates
          // the Dockerfile + builds the image with the local tag. The
          // `install:` field above injects the `RUN npm install`.
          await run(`yarn alepha build --target=docker --image=${image}`);

          if (shouldPush) {
            // `wrangler containers push <local-image>` retags the local
            // image to `registry.cloudflare.com/<account>/<image>` and
            // pushes there. Auth via CLOUDFLARE_API_TOKEN — no docker
            // login required (wrangler hands the credentials to docker
            // for the duration of the push).
            await run(`yarn wrangler containers push ${image}`);
          }
        },
      }),
    }),
  ],
});
