import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLOUDFLARE_TOKEN_TEMPLATE,
  cloudflareTokenTemplateUrl,
} from "@/api/schemas/cloudflareTokenTemplate.ts";
import { EstateCloudflareService } from "@/api/services/EstateCloudflareService.ts";

/**
 * The drift guard `PERMISSION_PROBES`'s own JSDoc says does not exist.
 *
 * One list is checked at save time, another pre-fills the dashboard form a
 * person mints their token on. They have to name the same six permissions,
 * and nothing else in the build can notice when they stop: `check:docs`
 * reads code samples, not two arrays in two files.
 *
 * ⚠️ Paired by PROBE KEY, never by index. Matching on order would go green
 * on a diff that reordered one list, and the pairing is the thing being
 * asserted - a seventh probe with no template row mints a token Lore then
 * refuses, which is a worse failure than the tedium the link removes.
 */
describe("the Cloudflare token template", () => {
  it("names exactly the permissions Lore probes for", () => {
    const probes = EstateCloudflareService.PERMISSION_PROBES.map(
      (probe) => probe.key,
    ).sort();
    const rows = CLOUDFLARE_TOKEN_TEMPLATE.map((row) => row.probe).sort();

    expect(rows).toEqual(probes);
  });

  it("keeps the two lists the same length, so a duplicate cannot hide a gap", () => {
    // ⚠️ Sorted key equality above would still pass if one list held a
    // duplicate and the other a row it is missing. This is the half that
    // catches it.
    expect(CLOUDFLARE_TOKEN_TEMPLATE).toHaveLength(
      EstateCloudflareService.PERMISSION_PROBES.length,
    );
    expect(
      new Set(CLOUDFLARE_TOKEN_TEMPLATE.map((row) => row.probe)).size,
    ).toBe(CLOUDFLARE_TOKEN_TEMPLATE.length);
  });

  it("spells R2's key the way the template namespace does", () => {
    // ⚠️ `workers_r2`, not `workers_r2_storage`. The template keys and the
    // dashboard's labels do not match everywhere, and a key derived from a
    // label is silently dropped by the form.
    const r2 = CLOUDFLARE_TOKEN_TEMPLATE.find((row) => row.probe === "r2");

    expect(r2?.key).toBe("workers_r2");
  });

  it("builds a URL whose permissions decode back to the six pairs", () => {
    // Decoded, not matched as a substring of the encoded blob: a test on the
    // raw string passes for a URL no browser can parse.
    const url = new URL(cloudflareTokenTemplateUrl());
    const decoded = JSON.parse(
      url.searchParams.get("permissionGroupKeys") ?? "[]",
    );

    expect(url.origin + url.pathname).toBe(
      "https://dash.cloudflare.com/profile/api-tokens",
    );
    expect(decoded).toEqual(
      CLOUDFLARE_TOKEN_TEMPLATE.map((row) => ({
        key: row.key,
        type: row.type,
      })),
    );
  });

  it("is the same URL the guide prints, character for character", () => {
    /*
     * ⚠️ The third copy the module's own doc warns about, and the only one
     * a person actually reads. A guide link that drifts from the builder
     * mints a token Lore then refuses, and the person followed our own
     * documentation to get it.
     *
     * Compared as a STRING rather than by decoding both: two URLs that
     * decode alike can still differ in encoding, and this is the copy
     * somebody pastes into an address bar.
     */
    const guide = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../docs/lore/1-guides/5-cloudflare-token.md",
      ),
      "utf8",
    );

    expect(guide).toContain(cloudflareTokenTemplateUrl());
  });

  it("carries no secret in the query string", () => {
    // The rule stated as a test, so a later change that "helpfully" adds the
    // token to the link goes red. A query string lands in browser history,
    // in a referrer and in any proxy's log.
    const url = new URL(cloudflareTokenTemplateUrl());

    expect([...url.searchParams.keys()].sort()).toEqual([
      "accountId",
      "name",
      "permissionGroupKeys",
      "zoneId",
    ]);
  });
});
