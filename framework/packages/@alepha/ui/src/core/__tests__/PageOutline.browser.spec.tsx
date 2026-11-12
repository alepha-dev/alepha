import { render, screen, waitFor } from "@testing-library/react";
import { expectAccessible } from "alepha/testing/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsDangerSection } from "../../settings/SettingsDangerSection.tsx";
import { SettingsRow } from "../../settings/SettingsRow.tsx";
import { SettingsSection } from "../../settings/SettingsSection.tsx";
import { outlineEntry, PageOutline } from "../PageOutline.tsx";

describe("PageOutline", () => {
  afterEach(() => {
    history.replaceState(null, "", window.location.pathname);
  });

  it("lists every section with an id, labelled by its title", async () => {
    render(
      <PageOutline>
        <SettingsSection id="general" title="General">
          <SettingsRow label="Name" />
        </SettingsSection>
        <SettingsSection title="Untargeted">
          <SettingsRow label="Hidden" />
        </SettingsSection>
        <div id="features" {...outlineEntry("Features")} />
        <SettingsDangerSection id="danger">
          <SettingsRow label="Delete" />
        </SettingsDangerSection>
      </PageOutline>,
    );

    const nav = await screen.findByRole("navigation", { name: "On this page" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["General", "#general"],
      ["Features", "#features"],
      ["Danger zone", "#danger"],
    ]);
    await expectAccessible();
  });

  it("draws no rail for a single entry", () => {
    render(
      <PageOutline>
        <SettingsSection id="only" title="Only">
          <SettingsRow label="Name" />
        </SettingsSection>
      </PageOutline>,
    );

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("picks up a section that renders after mount", async () => {
    const { rerender } = render(
      <PageOutline>
        <div id="a" {...outlineEntry("A")} />
      </PageOutline>,
    );
    expect(screen.queryByRole("navigation")).toBeNull();

    rerender(
      <PageOutline>
        <div id="a" {...outlineEntry("A")} />
        <div id="b" {...outlineEntry("B")} />
      </PageOutline>,
    );

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "B" })).toBeTruthy(),
    );
  });

  it("puts the entry in the hash on click and marks it current", async () => {
    render(
      <PageOutline>
        <div id="a" {...outlineEntry("A")} />
        <div id="b" {...outlineEntry("B")} />
      </PageOutline>,
    );

    const link = await screen.findByRole("link", { name: "B" });
    link.click();

    expect(window.location.hash).toBe("#b");
    await waitFor(() =>
      expect(link.getAttribute("aria-current")).toBe("location"),
    );
  });
});
