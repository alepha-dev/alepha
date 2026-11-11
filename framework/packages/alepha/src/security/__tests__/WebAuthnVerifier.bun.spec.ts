import { describe, expect, it } from "bun:test";

import { Alepha } from "alepha";

import { MemoryAuthenticatorCases } from "../../testing/webauthn/__tests__/MemoryAuthenticatorCases.ts";
import { WebAuthnCaseTable } from "./webauthn/WebAuthnCaseTable.ts";

const table = new WebAuthnCaseTable(new MemoryAuthenticatorCases().cases);

describe("WebAuthnVerifier on Bun", () => {
  for (const item of table.cases) {
    it(item.name, async () => {
      const alepha = Alepha.create();
      expect(await table.runOne(alepha, item)).toEqual(item.expected);
    });
  }
});
