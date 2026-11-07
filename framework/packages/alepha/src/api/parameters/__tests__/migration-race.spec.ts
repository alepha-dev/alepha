import { Alepha, z } from "alepha";
import { DbConflictError } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import { AlephaApiParameters } from "../index.ts";
import { $parameter } from "../primitives/$parameter.ts";
import { ParameterProvider } from "../services/ParameterProvider.ts";

/**
 * Two instances that load a parameter written under an older schema both
 * migrate it, and both compute the same next version. On workerd no lock
 * keeps them apart (it is per isolate), so the unique (name, version) index
 * does: the loser's insert conflicts, and it must read the winner's row
 * instead of failing the request (#Q3184).
 *
 * The spec plays both instances in one container: the save that migrates
 * first writes the other instance's row, then fails the way the losing
 * insert does.
 */
class RacingParameterProvider extends ParameterProvider {
  public racing = false;

  public forget(): void {
    this.cachedCurrent.clear();
    this.cachedNext.clear();
    this.loaded.clear();
    this.loadedAt.clear();
    this.migrationChecked.clear();
  }

  public override async save(
    ...args: Parameters<ParameterProvider["save"]>
  ): ReturnType<ParameterProvider["save"]> {
    if (!this.racing) return super.save(...args);
    this.racing = false;
    await super.save(...args);
    throw new DbConflictError("UNIQUE constraint failed: parameters.version");
  }
}

class FeatureFlags {
  public readonly flags = $parameter({
    name: "app.flags",
    schema: z.object({ maxUploads: z.integer() }),
    default: { maxUploads: 10 },
  });
}

describe("parameter auto-migration race", () => {
  it("reads the other instance's migrated row when its own insert conflicts", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    })
      .with({ provide: ParameterProvider, use: RacingParameterProvider })
      .with(AlephaSecurity)
      .with(AlephaApiParameters)
      .with(FeatureFlags);
    const parameters = alepha.inject(RacingParameterProvider);
    await alepha.start();

    // A row written under an older schema, which the current one rejects.
    await parameters.save("app.flags", { legacyShape: true }, "old-hash");
    parameters.forget();
    parameters.racing = true;

    const value = await alepha.inject(FeatureFlags).flags.get();

    expect(value).toEqual({ maxUploads: 10 });
    expect(parameters.racing).toBe(false);
    await alepha.stop();
  });
});
