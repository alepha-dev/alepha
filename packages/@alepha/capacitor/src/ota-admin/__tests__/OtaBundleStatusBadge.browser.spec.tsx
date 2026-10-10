import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it } from "vitest";

import { OtaBundleStatusBadge } from "../components/OtaBundleStatusBadge.tsx";

const render = async (
  bundle: Parameters<typeof OtaBundleStatusBadge>[0]["bundle"],
) => {
  const alepha = Alepha.create().with(AlephaReactI18n);
  await alepha.start();
  const container = document.createElement("div");
  await act(async () => {
    createRoot(container).render(
      <AlephaContext.Provider value={alepha}>
        <OtaBundleStatusBadge bundle={bundle} />
      </AlephaContext.Provider>,
    );
  });
  return container.textContent;
};

describe("OtaBundleStatusBadge", () => {
  it("shows a killed bundle as killed, whatever its status", async ({
    expect,
  }) => {
    expect(
      await render({ status: "ready", killedAt: "2026-10-10T12:00:00Z" }),
    ).toBe("Killed");
    expect(await render({ status: "ready" })).toBe("Ready");
    expect(await render({ status: "deleted" })).toBe("Deleted");
  });
});
