import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsDangerSection } from "../settings-danger-section.tsx";
import { SettingsRow } from "../settings-row.tsx";
import { SettingsSection } from "../settings-section.tsx";

/**
 * These pin the padding contract, which is the one thing about this kit that
 * is invisible in a screenshot review and has already gone wrong four times
 * by hand in `apps/lore`: the card must carry `py-0` and each row its own
 * `py-3`. Doubling them produces a thick blank band top and bottom.
 */
describe("SettingsSection", () => {
  it("opts the card out of vertical padding so rows own it", () => {
    const { container } = render(
      <SettingsSection title="General">
        <SettingsRow label="Name">control</SettingsRow>
      </SettingsSection>,
    );

    const card = container.querySelector('[data-slot="card"]');
    expect(card?.className).toContain("py-0");
    // A numeric py-* on the card is the anti-pattern, not a smaller variant.
    expect(card?.className).not.toMatch(/\bpy-[1-9]/);

    const row = container.querySelector('[data-slot="card-content"]');
    expect(row?.className).toContain("py-3");
  });

  it("divides rows and keeps the card gapless", () => {
    const { container } = render(
      <SettingsSection>
        <SettingsRow label="One" />
        <SettingsRow label="Two" />
      </SettingsSection>,
    );

    const card = container.querySelector('[data-slot="card"]');
    expect(card?.className).toContain("divide-y");
    expect(card?.className).toContain("gap-0");
    expect(
      container.querySelectorAll('[data-slot="card-content"]'),
    ).toHaveLength(2);
  });

  it("renders no heading block when given neither title nor description", () => {
    const { container } = render(
      <SettingsSection>
        <SettingsRow label="Only" />
      </SettingsSection>,
    );

    // Heading block + card would be two children; without a heading, one.
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it("renders title and description when both are given", () => {
    render(
      <SettingsSection title="General" description="Who you are">
        <SettingsRow label="Name" />
      </SettingsSection>,
    );

    expect(screen.getByText("General")).toBeTruthy();
    expect(screen.getByText("Who you are")).toBeTruthy();
  });
});

describe("SettingsRow", () => {
  it("keeps the label column shrinkable so a long label cannot push the control out", () => {
    const { container } = render(
      <SettingsRow label="Name">control</SettingsRow>,
    );

    const row = container.querySelector('[data-slot="card-content"]');
    expect(row?.className).toContain("sm:grid-cols-[minmax(0,1fr)_auto]");
  });

  it("omits the description line entirely when not given", () => {
    const { container } = render(<SettingsRow label="Name" />);

    // An empty <span> would still occupy a grid row and add a gap under the
    // label, so "absent" has to mean absent, not blank.
    const labelColumn = container.querySelector(
      '[data-slot="card-content"] > div',
    );
    expect(labelColumn?.children).toHaveLength(1);
    expect(labelColumn?.textContent).toBe("Name");
  });

  it("renders the control when given", () => {
    render(
      <SettingsRow label="Name" description="Your display name">
        <button type="button">Edit</button>
      </SettingsRow>,
    );

    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByText("Your display name")).toBeTruthy();
  });
});

describe("SettingsDangerSection", () => {
  it("defaults its title and tints the border without shouting", () => {
    const { container } = render(
      <SettingsDangerSection>
        <SettingsRow label="Delete account" />
      </SettingsDangerSection>,
    );

    expect(screen.getByText("Danger zone")).toBeTruthy();

    const card = container.querySelector('[data-slot="card"]');
    expect(card?.className).toContain("border-destructive/30");
    // Full-strength destructive reads as "this page is broken".
    expect(card?.className).not.toMatch(/border-destructive(?![/-])/);
  });

  it("keeps the same padding contract as a normal section", () => {
    const { container } = render(
      <SettingsDangerSection title="Danger">
        <SettingsRow label="Delete account" />
      </SettingsDangerSection>,
    );

    const card = container.querySelector('[data-slot="card"]');
    expect(card?.className).toContain("py-0");
    expect(card?.className).not.toMatch(/\bpy-[1-9]/);
  });
});
