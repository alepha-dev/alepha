import { describe, it } from "vitest";

import { tokensSchema } from "../schemas/tokensSchema.ts";
import { OAuthTokenNormalizer } from "../services/OAuthTokenNormalizer.ts";

describe("provider token responses", () => {
  it("preserves Keycloak's refresh lifetime before stored tokens strip unknown fields", ({
    expect,
  }) => {
    const normalizer = new OAuthTokenNormalizer();
    const response = {
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 300,
      refresh_expires_in: 1800,
      token_type: "Bearer",
    };
    const normalized = normalizer.normalize(response);
    expect(normalized).not.toHaveProperty("refresh_expires_in");
    const stored = tokensSchema.parse({
      ...normalized,
      provider: "keycloak",
      issued_at: 1000,
    });
    expect(stored.refresh_token_expires_in).toBe(1800);
    expect(stored.expires_in).toBe(300);
    expect(stored).not.toHaveProperty("refresh_expires_in");
    expect(stored).not.toHaveProperty("token_type");
    expect(response.refresh_expires_in).toBe(1800);
  });

  it("keeps an explicit canonical lifetime and ignores invalid provider values", ({
    expect,
  }) => {
    const normalizer = new OAuthTokenNormalizer();
    expect(
      normalizer.normalize({
        refresh_token_expires_in: 3600,
        refresh_expires_in: 1800,
      }),
    ).toEqual({ refresh_token_expires_in: 3600 });
    expect(normalizer.normalize({ refresh_expires_in: "1800" })).toEqual({});
  });
});
