import { type Alepha, t } from "alepha";
import { buildOptions } from "alepha/cli";
import { $command } from "alepha/command";

export default (alepha: Alepha) => {
  alepha.set(buildOptions, {
    docker: {
      // Both binaries are needed inside the image:
      //   - `wrangler`: invoked by `CloudflareAdapter` for `wrangler
      //     deploy` + `wrangler d1 migrations apply --remote`. The
      //     REST-only port is a v2 follow-up; until then wrangler is
      //     non-optional.
      //   - `alepha`: the `DeployRunner` shells out to `alepha platform
      //     <op>` against the extracted workspace. Pre-installing avoids
      //     the `npx alepha` cold-fetch on every deploy.
      install: ["alepha", "wrangler"],
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
  });

  return {
    // -------------------------------------------------------------------------
    // Run locally — credentials come from your `docker login` session.
    //
    //   yarn workspace rocket push                # → alepha/rocket:latest
    //   yarn workspace rocket push --tag 0.21.1   # → alepha/rocket:0.21.1
    //   yarn workspace rocket push --push=false   # build only
    // -------------------------------------------------------------------------
    "rocket:push": $command({
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
        await run(`alepha build --target=docker --image=${image}`);

        if (shouldPush) {
          await run(`docker push ${image}`);
        }
      },
    }),
  };
};
