import { describe, it } from "vitest";

import { withWorkerd } from "../../ai/core/__tests__/workerdHarness.ts";
import { MemoryAuthenticatorCases } from "../../testing/webauthn/__tests__/MemoryAuthenticatorCases.ts";
import { WebAuthnCaseTable } from "./webauthn/WebAuthnCaseTable.ts";

const table = new WebAuthnCaseTable(new MemoryAuthenticatorCases().cases);

/**
 * The verifier's case table, bundled for workerd and run in Miniflare: the
 * WebCrypto paths most likely to differ by runtime (Ed25519, RSA, the DER
 * conversion) run on the real thing.
 */
describe("WebAuthnVerifier (workerd)", () => {
  it("every case of the table ends as it does on Node", async ({ expect }) => {
    const tablePath = new URL(
      "./webauthn/WebAuthnCaseTable.ts",
      import.meta.url,
    ).pathname;
    const generatedPath = new URL(
      "../../testing/webauthn/__tests__/MemoryAuthenticatorCases.ts",
      import.meta.url,
    ).pathname;
    const results = await withWorkerd(
      {
        name: "webauthn-verifier",
        source: `
import { Alepha } from "alepha";
import { WebAuthnCaseTable } from ${JSON.stringify(tablePath)};
import { MemoryAuthenticatorCases } from ${JSON.stringify(generatedPath)};
export default { async fetch() {
  const table = new WebAuthnCaseTable(new MemoryAuthenticatorCases().cases);
  const out = [];
  for (const item of table.cases) {
    out.push({ name: item.name, outcome: await table.runOne(Alepha.create(), item) });
  }
  return Response.json(out);
} };
`,
      },
      async (dispatch) => (await dispatch({})).json(),
    );
    expect(results).toEqual(
      table.cases.map((item) => ({ name: item.name, outcome: item.expected })),
    );
  }, 120_000);
});
