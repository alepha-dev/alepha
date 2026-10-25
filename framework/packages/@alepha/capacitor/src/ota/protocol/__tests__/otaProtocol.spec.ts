import { describe, it } from "vitest";

import { otaWireFixtures } from "../__fixtures__/otaWireFixtures.ts";
import { otaChannelGetResponseSchema } from "../otaChannelGetResponseSchema.ts";
import { otaChannelListResponseSchema } from "../otaChannelListResponseSchema.ts";
import { otaChannelSetResponseSchema } from "../otaChannelSetResponseSchema.ts";
import { otaDeviceSchema } from "../otaDeviceSchema.ts";
import { otaStatsRequestSchema } from "../otaStatsRequestSchema.ts";
import { otaUpdateAvailableSchema } from "../otaUpdateAvailableSchema.ts";
import { otaUpdateBuiltinSchema } from "../otaUpdateBuiltinSchema.ts";
import { otaUpdateErrorSchema } from "../otaUpdateErrorSchema.ts";
import { otaUpdateNoneSchema } from "../otaUpdateNoneSchema.ts";
import { otaUpdateResponseSchema } from "../otaUpdateResponseSchema.ts";

describe("ota/protocol", () => {
  it("assigns every fixture to the client's or the server's acceptance", ({
    expect,
  }) => {
    for (const [name, fixture] of Object.entries(otaWireFixtures)) {
      expect(["Q1312", "Q1303"], name).toContain(fixture.owner);
    }
  });

  it("reads every request the pinned plugin sends", ({ expect }) => {
    const f = otaWireFixtures;
    expect(otaDeviceSchema.parse(f.updateRequestIos.body).version_code).toBe(
      "1",
    );
    expect(
      otaDeviceSchema.parse(f.updateRequestAndroid.body).defaultChannel,
    ).toBe("beta");
    expect(otaDeviceSchema.parse(f.channelSetRequest.body).channel).toBe(
      "beta",
    );
    expect(otaDeviceSchema.parse(f.channelGetRequest.body).platform).toBe(
      "android",
    );
    expect(otaStatsRequestSchema.parse(f.statsBatch.body)).toHaveLength(1);
    // The list call's query carries booleans as strings: a server reads it
    // after coercing them.
    const query: Record<string, string> = f.channelListRequest.query;
    expect(
      otaDeviceSchema.parse({
        ...query,
        is_prod: query.is_prod === "true",
        is_emulator: query.is_emulator === "true",
      }).platform,
    ).toBe("ios");
    expect(otaStatsRequestSchema.parse(f.statsSingle.body)).toMatchObject({
      action: "rate_limit_reached",
    });
  });

  it("tells every update answer apart", ({ expect }) => {
    const f = otaWireFixtures;
    expect(
      otaUpdateAvailableSchema.safeParse(f.updateAvailable.body).success,
    ).toBe(true);
    expect(otaUpdateNoneSchema.safeParse(f.updateNone.body).success).toBe(true);
    expect(otaUpdateBuiltinSchema.safeParse(f.updateBuiltin.body).success).toBe(
      true,
    );
    expect(otaUpdateErrorSchema.safeParse(f.updateBlocked.body).success).toBe(
      true,
    );
    expect(otaUpdateErrorSchema.safeParse(f.updateMalformed.body).success).toBe(
      true,
    );
    // "builtin" is never mistaken for a bundle to download.
    expect(
      otaUpdateAvailableSchema.safeParse(f.updateBuiltin.body).success,
    ).toBe(false);
    for (const body of [
      f.updateAvailable.body,
      f.updateNone.body,
      f.updateBuiltin.body,
      f.updateBlocked.body,
      f.updateMalformed.body,
    ]) {
      expect(otaUpdateResponseSchema.safeParse(body).success).toBe(true);
    }
  });

  it("reads every channel answer", ({ expect }) => {
    const f = otaWireFixtures;
    expect(
      otaChannelSetResponseSchema.parse(f.channelSetAccepted.body).status,
    ).toBe("ok");
    expect(
      otaChannelSetResponseSchema.parse(f.channelSetPublic.body).unset,
    ).toBe(true);
    expect(
      otaChannelSetResponseSchema.parse(f.channelSetRefused.body).error,
    ).toBe("channel_self_set_not_allowed");
    expect(
      otaChannelGetResponseSchema.parse(f.channelGetAnswer.body).allowSet,
    ).toBe(true);
    expect(
      otaChannelListResponseSchema.parse(f.channelListAnswer.body),
    ).toHaveLength(1);
  });

  it("drops fields it does not know and bounds the ones it does", ({
    expect,
  }) => {
    const parsed = otaDeviceSchema.parse({
      ...otaWireFixtures.updateRequestIos.body,
      unexpected: "x",
    });
    expect("unexpected" in parsed).toBe(false);
    expect(
      otaDeviceSchema.safeParse({
        ...otaWireFixtures.updateRequestIos.body,
        device_id: "x".repeat(200),
      }).success,
    ).toBe(false);
    expect(
      otaStatsRequestSchema.safeParse(
        Array.from({ length: 201 }, () => otaWireFixtures.statsSingle.body),
      ).success,
    ).toBe(false);
  });
});
