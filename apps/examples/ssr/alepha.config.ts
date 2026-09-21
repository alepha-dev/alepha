import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
  dev: { port: 3311 },
  plugins: [
    platform({
      environments: {
        production: { adapter: "cloudflare" },
      },
    }),
  ],
  build: {
    // ⚠️ A runtime, not a target. `--target=cloudflare` said "link for
    // workerd" and nothing else, and it could only ever name one slice, which
    // made a `node,workerd` build impossible to express. Declaring the slice
    // is what asks for the Cloudflare deploy config now.
    runtime: ["workerd"],
  },
});
