import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { MemoryAuthenticatorCases } from "../../testing/webauthn/__tests__/MemoryAuthenticatorCases.ts";
import { WebAuthnCaseTable } from "./webauthn/WebAuthnCaseTable.ts";

const table = new WebAuthnCaseTable(new MemoryAuthenticatorCases().cases);

describe("WebAuthnVerifier", () => {
  it.for(table.cases)("$name", async (item, { expect }) => {
    const alepha = Alepha.create();
    expect(await table.runOne(alepha, item)).toEqual(item.expected);
  });
});
