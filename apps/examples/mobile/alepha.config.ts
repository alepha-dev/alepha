import { capacitor } from "@alepha/capacitor/cli";
import { defineConfig } from "alepha/cli/config";

/**
 * The test bed of `@alepha/capacitor`: see README.md.
 *
 * `apiUrl` is the API the native shell calls. It differs per machine (a LAN
 * address for a phone, an e2e port in CI), so it comes from the environment:
 * `MOBILE_API_URL=https://192.168.1.48:8443 yarn alepha capacitor sync`.
 */
export default defineConfig({
  dev: { port: 3313 },
  plugins: [
    capacitor({
      appId: "dev.alepha.mobile",
      appName: "Alepha Mobile",
      scheme: "alephamobile",
      apiUrl: process.env.MOBILE_API_URL,
    }),
  ],
});
