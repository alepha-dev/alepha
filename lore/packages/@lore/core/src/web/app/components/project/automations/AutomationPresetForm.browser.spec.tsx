import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { afterEach, describe, it } from "vitest";

import type { AutomationPresetDescriptor } from "../../../../../api/schemas/automationPresetDescriptorSchema.ts";
import { I18n } from "../../../services/I18n.ts";
import AutomationPresetForm from "./AutomationPresetForm.tsx";

/**
 * The shared setup surface renders catalogue fields as form controls. Selecting
 * a recipient yields a local UUID and never creates a shared-variable binding.
 */
describe("Automation preset setup form", () => {
  let alepha: Alepha | undefined;
  afterEach(async () => {
    cleanup();
    await alepha?.stop();
  });
  it("generates labeled member/channel/tag controls and submits native literal setup", async ({
    expect,
  }) => {
    const memberId = crypto.randomUUID();
    const saved: unknown[] = [];
    const preset: AutomationPresetDescriptor = {
      key: "tagged-quest-digest",
      title: "Nightly tagged quests",
      description: "Midnight digest",
      source: "quests.tagged",
      schedule: "0 0 * * *",
      fields: {},
      permissions: [],
      needs: [],
      slots: {
        recipient: { kind: "member", required: true },
        channel: {
          kind: "channel",
          required: true,
          default: "inbox",
          values: ["inbox", "email"],
        },
        tag: { kind: "text", required: true, min: 1 },
      },
    };
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReactI18n)
      .with(AlephaReactUi);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <AutomationPresetForm
          preset={preset}
          choices={{ recipient: [{ value: memberId, label: "Myself" }] }}
          onSubmit={async (values) => {
            saved.push(values);
          }}
        />
      </AlephaContext.Provider>,
    );
    expect(screen.getByText(/00:00 UTC/)).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Channel" }).textContent,
    ).toContain("Inbox");
    fireEvent.click(screen.getByRole("combobox", { name: "Recipient" }));
    fireEvent.click(await screen.findByRole("option", { name: "Myself" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tag" }), {
      target: { value: "daily" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create disabled automation" }),
    );
    await waitFor(() =>
      expect(saved).toEqual([
        { recipient: memberId, channel: "inbox", tag: "daily" },
      ]),
    );
  });
});
