import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { afterEach, describe, expect, it } from "vitest";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";

import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import EpicReleaseControl from "./EpicReleaseControl.tsx";

const epic = {
  id: 7,
  number: 24,
  projectId: 1,
  title: "Lore Deploy",
  description: "",
  status: "active",
  releaseId: 3,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
} as unknown as EpicResource;

/**
 * The epic aside's release row (feedback #2061): the value used to be a bare
 * select, while every other place a release is named draws lucide's `Flag`
 * beside it. The glyph is what makes "0.28.0" read as a release.
 */
describe("EpicReleaseControl - the release glyph", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async () => {
    alepha = Alepha.create()
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    // The atom validates against `releaseResourceSchema`: the whole
    // required shape, progress rollup included.
    alepha.store.set(currentReleasesAtom, [
      {
        id: 3,
        projectId: 1,
        number: 1,
        tag: "0.28.0",
        title: "Twenty-eight",
        description: "",
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
      },
    ] as never);
    return render(
      <AlephaContext.Provider value={alepha}>
        <EpicReleaseControl epic={epic} onChange={() => undefined} />
      </AlephaContext.Provider>,
    );
  };

  it("draws the Flag beside the release in the trigger", async () => {
    await mount();

    const trigger = await screen.findByRole("combobox", { name: "Release" });
    expect(trigger.textContent).toContain("0.28.0");
    // lucide stamps each icon with its name, which is the one hook a test
    // has on "which glyph" without reading path data.
    expect(trigger.querySelector("svg.lucide-flag")).not.toBeNull();
  });
});
