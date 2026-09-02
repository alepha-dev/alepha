import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";

import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import EpicReleaseControl from "./EpicReleaseControl.tsx";

/**
 * Nothing here picks a release, so the client is never reached; the seam
 * exists so `useClient` has something to hand out.
 */
class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {};
  }
}

const aRelease = {
  id: 11,
  projectId: 1,
  number: 1,
  tag: "0.28.0",
  title: "0.28.0",
  description: "",
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
  progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
};

const anEpic = {
  id: 1,
  projectId: 1,
  number: 24,
  title: "Kanban v2",
  status: "done",
  releaseId: aRelease.id,
  progress: { completed: 0, total: 0 },
} as unknown as EpicResource;

/**
 * The aside decorates its status value with the status glyph, and every other
 * surface that names a release carries lucide's `Flag`; this row was the one
 * place a release was named bare (feedback #2061). Lucide names the svg after
 * the icon, so `svg.lucide-flag` is the flag and nothing else.
 */
describe("EpicReleaseControl", () => {
  it("carries the release glyph on its trigger", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before the modules that reach for it: a substitution after
      // `LinkProvider` has been instantiated is a `TooLateSubstitutionError`.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    alepha.store.set(currentReleasesAtom, [aRelease]);

    const { container } = render(
      <AlephaContext.Provider value={alepha}>
        <EpicReleaseControl epic={anEpic} onChange={() => {}} />
      </AlephaContext.Provider>,
    );

    const trigger = await screen.findByRole("combobox");
    expect(trigger.textContent).toContain("0.28.0");
    expect(container.querySelector("svg.lucide-flag")).not.toBeNull();

    await alepha.stop();
  });
});
