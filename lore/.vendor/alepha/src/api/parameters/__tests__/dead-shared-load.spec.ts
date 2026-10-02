import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";

import {
  $parameter,
  AlephaApiParameters,
  ParameterProvider,
} from "../index.ts";

/**
 * Stands in for a load whose request was canceled on Workers: its query
 * never settles, so neither does the promise shared in `loadPromises`.
 */
class StallingParameterProvider extends ParameterProvider {
  protected override readonly sharedLoadWaitMs = 20;

  public stallNextLoad = false;

  public get inFlightLoads(): number {
    return this.loadPromises.size;
  }

  public override async loadCurrentAndNext(
    name: string,
  ): ReturnType<ParameterProvider["loadCurrentAndNext"]> {
    if (this.stallNextLoad) {
      this.stallNextLoad = false;
      return new Promise(() => {});
    }
    return super.loadCurrentAndNext(name);
  }
}

class DeadLoadParameters {
  settings = $parameter({
    name: "dead.load.settings",
    schema: z.object({ value: z.number() }),
    default: { value: 1 },
  });
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", PARAMETERS_CACHE_TTL_MS: "1000" },
  })
    .with({ provide: ParameterProvider, use: StallingParameterProvider })
    .with(AlephaOrmPostgres)
    .with(AlephaApiParameters)
    .with(DeadLoadParameters);
  await alepha.start();
  const settings = alepha.inject(DeadLoadParameters).settings;
  const provider = alepha.inject(StallingParameterProvider);
  await provider.save(settings.name, { value: 2 }, "");
  return { settings, provider, time: alepha.inject(DateTimeProvider) };
};

describe("ParameterProvider shared load that never settles", () => {
  it("still answers every get() joined to it, from a load of their own", async () => {
    const { settings, provider, time } = await setup();
    await time.travel(2, "seconds");
    provider.stallNextLoad = true;

    // The first get() starts the load that stalls; the second joins it.
    const values = await Promise.all([settings.get(), settings.get()]);

    expect(values).toEqual([{ value: 2 }, { value: 2 }]);
    expect(provider.inFlightLoads).toBe(0);
  });

  it("revalidates normally once the dead load has been replaced", async () => {
    const { settings, provider, time } = await setup();
    await time.travel(2, "seconds");
    provider.stallNextLoad = true;
    await settings.get();

    await provider.save(settings.name, { value: 3 }, "");
    await time.travel(2, "seconds");

    expect(await settings.get()).toEqual({ value: 3 });
    expect(provider.inFlightLoads).toBe(0);
  });
});
