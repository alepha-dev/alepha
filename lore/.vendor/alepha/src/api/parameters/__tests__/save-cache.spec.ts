import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";

import {
  $parameter,
  AlephaApiParameters,
  ParameterProvider,
} from "../index.ts";

class SaveCacheParameters {
  settings = $parameter({
    name: "save.cache.settings",
    schema: z.object({ value: z.number(), label: z.text().default("default") }),
    default: { value: 1, label: "default" },
  });
}

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaApiParameters)
    .with(SaveCacheParameters);
  await alepha.start();
  const settings = alepha.inject(SaveCacheParameters).settings;
  await settings.get();
  return {
    settings,
    provider: alepha.inject(ParameterProvider),
    time: alepha.inject(DateTimeProvider),
  };
};

describe("ParameterProvider direct save cache", () => {
  it("serves validated saved content immediately and notifies subscribers once", async () => {
    const { settings, provider } = await setup();
    const received: unknown[] = [];
    settings.sub((value) => received.push(value));

    await provider.save(settings.name, { value: 2 }, "");

    const expected = { value: 2, label: "default" };
    expect(provider.getCachedCurrentContent(settings.name)).toEqual(expected);
    expect(await settings.get()).toEqual(expected);
    expect(
      (await provider.getCurrentWithDefault(settings.name)).currentValue,
    ).toEqual(expected);
    expect(received).toEqual([expected]);

    await provider.save(settings.name, { value: 2 }, "");
    expect(received).toEqual([expected]);
  });

  it("activates a directly saved future version only when its date arrives", async () => {
    const { settings, provider, time } = await setup();
    const received: unknown[] = [];
    settings.sub((value) => received.push(value));
    await provider.save(settings.name, { value: 3 }, "", {
      activationDate: time.now().add(1, "hour").toDate(),
    });

    expect(await settings.get()).toEqual({ value: 1, label: "default" });
    expect(received).toEqual([]);
    await time.travel(2, "hours");
    expect(await settings.get()).toEqual({ value: 3, label: "default" });
  });

  it("keeps the current value when a saved version is already expired", async () => {
    const { settings, provider, time } = await setup();
    await provider.save(settings.name, { value: 2 }, "");
    const received: unknown[] = [];
    settings.sub((value) => received.push(value));

    const saved = await provider.save(settings.name, { value: 9 }, "", {
      activationDate: time.now().subtract(1, "day").toDate(),
    });

    expect(saved.status).toBe("expired");
    expect(await settings.get()).toEqual({ value: 2, label: "default" });
    expect(received).toEqual([]);
  });
});
