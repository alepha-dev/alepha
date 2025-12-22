import { $command } from "alepha/command";
import { loadEnv } from "vite";

export default () => {
  return {
    deploy: $command({
      handler: async ({ run, root }) => {
        await run("yarn alepha build --cloudflare");
        await run("yarn alepha db:migrate --mode=production");

        Object.assign(process.env, loadEnv("production", root, "CLOUDFLARE"));

        await run("yarn wrangler deploy -c=dist/wrangler.jsonc");
      },
    }),
  };
};
