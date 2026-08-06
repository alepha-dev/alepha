import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { sigilClientAtom } from "../../shared/sigilClientAtom.ts";
import {
  allTrackersEnabled,
  type SigilTracker,
} from "../../shared/sigilFeatures.ts";
import { SigilBrowserProvider } from "../SigilBrowserProvider.ts";

/**
 * `wants` is protected — it is the decision, not the surface. Subclassing to
 * reach it is the repo's pattern for exactly this.
 */
class TestBrowserProvider extends SigilBrowserProvider {
  public testWants(tracker: SigilTracker): boolean {
    return this.wants(tracker);
  }
}

const make = () =>
  Alepha.create({
    env: { NODE_ENV: "production", APP_SECRET: "test-secret", SERVER_PORT: 0 },
  });

const setConfig = (alepha: Alepha, sampling: Record<string, number>) =>
  alepha.store.set(sigilClientAtom, {
    enabled: allTrackersEnabled(),
    sampling,
    excludedPaths: [],
    feedbackUrl: undefined,
  } as any);

describe("SigilBrowserProvider sampling", () => {
  it("gives the same answer for every event of a page load", () => {
    // The regression guard. Per-event sampling meant a one-view visitor was
    // far likelier to send nothing at all than a ten-view visitor, so the
    // unique count decayed non-linearly and skewed toward engaged visitors.
    // A rate of 0.5 over 200 calls would be astronomically unlikely to be
    // constant by chance.
    const alepha = make();
    const provider = alepha.inject(TestBrowserProvider);
    setConfig(alepha, { views: 0.5 });

    const answers = new Set(
      Array.from({ length: 200 }, () => provider.testWants("views")),
    );

    expect(answers.size).toBe(1);
  });

  it("holds each tracker's verdict independently", () => {
    const alepha = make();
    const provider = alepha.inject(TestBrowserProvider);
    setConfig(alepha, { views: 1, vitals: 0 });

    expect(provider.testWants("views")).toBe(true);
    expect(provider.testWants("vitals")).toBe(false);
    expect(provider.testWants("views")).toBe(true);
  });

  it("re-rolls when hydration changes the rate", () => {
    // Buffered vitals fire before the atom is hydrated, when the rate still
    // reads as the default 1. Caching on first use alone would pin "keep
    // everything" for the whole visit and silently defeat the sink's rate.
    const alepha = make();
    const provider = alepha.inject(TestBrowserProvider);

    setConfig(alepha, { vitals: 1 });
    expect(provider.testWants("vitals")).toBe(true);

    setConfig(alepha, { vitals: 0 });
    expect(provider.testWants("vitals")).toBe(false);
  });

  it("never samples errors away, whatever the rate says", () => {
    const alepha = make();
    const provider = alepha.inject(TestBrowserProvider);
    setConfig(alepha, { errors: 0 });

    expect(provider.testWants("errors")).toBe(true);
  });

  it("still obeys the kill-switch on every event, cached roll or not", () => {
    const alepha = make();
    const provider = alepha.inject(TestBrowserProvider);

    setConfig(alepha, { views: 1 });
    expect(provider.testWants("views")).toBe(true);

    alepha.store.set(sigilClientAtom, {
      enabled: { ...allTrackersEnabled(), views: false },
      sampling: { views: 1 },
      excludedPaths: [],
      feedbackUrl: undefined,
    } as any);
    expect(provider.testWants("views")).toBe(false);
  });
});
