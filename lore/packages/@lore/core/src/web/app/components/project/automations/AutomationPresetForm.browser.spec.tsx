import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha, AlephaError } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { AutomationPresetDescriptor } from "../../../../../api/schemas/automationPresetDescriptorSchema.ts";
import { I18n } from "../../../services/I18n.ts";
import AutomationPresetForm from "./AutomationPresetForm.tsx";

/**
 * The shared setup surface renders catalogue fields as form controls. Selecting
 * a recipient yields a local UUID and never creates a shared-variable binding.
 */
describe("Automation preset setup form", () => {
  beforeAll(() => {
    // The sharing choice is a `Segmented`, which measures its own thumb.
    setupJsdomMocks();
  });
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
    // Every field belongs to this rule until sharing is asked for.
    expect(screen.queryByRole("radio")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Channel" }).textContent,
    ).toContain("Inbox");
    fireEvent.click(screen.getByRole("combobox", { name: "Recipient" }));
    fireEvent.click(await screen.findByRole("option", { name: "Myself" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tag" }), {
      target: { value: "daily" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));
    await waitFor(() =>
      expect(saved).toEqual([
        { recipient: memberId, channel: "inbox", tag: "daily" },
      ]),
    );
  });
  it("submits an explicitly selected shared identity and version without creating a variable", async ({
    expect,
  }) => {
    const memberId = crypto.randomUUID();
    const variableId = crypto.randomUUID();
    const saved: unknown[] = [];
    const preset: AutomationPresetDescriptor = {
      key: "epic-completed",
      title: "Epic completed",
      description: "Event",
      source: "epic.completed",
      fields: {},
      needs: [],
      permissions: [],
      slots: {
        recipient: { kind: "member", required: true, bindable: true },
        channel: {
          kind: "channel",
          required: true,
          default: "inbox",
          values: ["inbox", "email"],
        },
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
          variables={[
            {
              id: variableId,
              key: "teamRecipient",
              kind: "member",
              version: 3,
              available: true,
              value: { kind: "member", value: memberId },
            },
          ]}
          onSubmit={async (values, bindings) => {
            saved.push({ values, bindings });
          }}
        />
      </AlephaContext.Provider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Share with other automations" }),
    );
    expect(
      screen
        .getByRole("radio", { name: "Shared variable" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("combobox", { name: "Recipient shared variable" }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "teamRecipient (v3)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));
    await waitFor(() =>
      expect(saved).toEqual([
        {
          values: { recipient: memberId, channel: "inbox" },
          bindings: {
            recipient: { id: variableId, key: "teamRecipient", version: 3 },
          },
        },
      ]),
    );
  });

  it("retains an explicitly created variable when rule creation fails so retry cannot replace its key", async ({
    expect,
  }) => {
    const memberId = crypto.randomUUID();
    const variableId = crypto.randomUUID();
    let created = 0;
    let attempts = 0;
    const saved: unknown[] = [];
    const preset: AutomationPresetDescriptor = {
      key: "epic-completed",
      title: "Epic completed",
      description: "Event",
      source: "epic.completed",
      fields: {},
      needs: [],
      permissions: [],
      slots: {
        recipient: { kind: "member", required: true, bindable: true },
        channel: {
          kind: "channel",
          required: true,
          default: "inbox",
          values: ["inbox", "email"],
        },
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
          canManageVariables
          onCreateShared={async (key, value) => {
            created++;
            return {
              id: variableId,
              key,
              kind: "member",
              version: 0,
              available: true,
              value,
            };
          }}
          onSubmit={async (values, bindings) => {
            attempts++;
            if (attempts === 1) throw new AlephaError("Rule creation refused");
            saved.push({ values, bindings });
          }}
        />
      </AlephaContext.Provider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Share with other automations" }),
    );
    expect(
      screen
        .getByRole("radio", { name: "New shared variable" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("combobox", { name: "Recipient" }));
    fireEvent.click(await screen.findByRole("option", { name: "Myself" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "New variable key" }),
      { target: { value: "teamRecipient" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));
    await waitFor(() => expect(attempts).toBe(1));
    await waitFor(() =>
      expect(
        screen
          .getByRole("radio", { name: "Shared variable" })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));
    await waitFor(() =>
      expect(saved).toEqual([
        {
          values: { recipient: memberId, channel: "inbox" },
          bindings: {
            recipient: { id: variableId, key: "teamRecipient", version: 0 },
          },
        },
      ]),
    );
    expect(created).toBe(1);
  });
});
