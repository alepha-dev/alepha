import { I18n } from "@lore/core/web";
import { cleanup, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import MonitorFormDialog from "../src/web/app/components/project/uptime/MonitorFormDialog.tsx";

/**
 * Records every API call and answers each with an empty object.
 */
class FakeLinkProvider extends LinkProvider {
  calls: Array<{ name: string; args: unknown[] }> = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) =>
        Object.assign(
          async (...args: unknown[]) => {
            this.calls.push({ name, args });
            return {};
          },
          { can: () => true },
        ),
    });
  }
}

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaReact)
    .with(AlephaReactI18n)
    .with(I18n)
    .with({ provide: LinkProvider, use: FakeLinkProvider });
  await alepha.start();
  await alepha.inject(I18nProvider).setLang("en");
  return alepha;
};

describe("Monitor form dialog", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });
  afterEach(cleanup);

  it("marks Recipients as optional by schema, not by a hand-written label", async ({
    expect,
  }) => {
    // #Q2679: the label said "(optional)" while the form drew the required
    // marker beside it. The field is optional in the form schema now, so no
    // marker is drawn and the label carries no parenthesis.
    const alepha = await boot();
    try {
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <MonitorFormDialog projectId={1} onClose={() => {}} />
        </AlephaContext.Provider>,
      );
      const recipients = await view.findByLabelText("Recipients");
      expect(recipients.getAttribute("aria-required")).toBeNull();
      expect(view.queryByText(/\(optional\)/)).toBeNull();
      expect(view.getByLabelText(/^Name/).getAttribute("aria-required")).toBe(
        "true",
      );
    } finally {
      await alepha.stop();
    }
  });
});
