import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, expect, it } from "vitest";

import { I18n } from "../../services/I18n.ts";
import { MemberIdentity, type MemberWithUser } from "./MemberIdentity.tsx";

const memberOf = (owner: boolean): MemberWithUser =>
  ({
    id: 1,
    projectId: 1,
    userId: "00000000-0000-4000-8000-000000000001",
    owner,
    createdAt: "2026-08-26T10:00:00.000Z",
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      username: "nfo",
      email: "nfo@example.com",
    },
  }) as unknown as MemberWithUser;

/**
 * A member's identity is the row, not a hover surface over it (feedback
 * #2067): the card that used to open on hover repeated the picture and the
 * name, and the one thing it alone showed, the Owner badge, now sits inline.
 */
describe("MemberIdentity", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (member: MemberWithUser, variant: "card" | "compact") => {
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    return render(
      <AlephaContext.Provider value={alepha}>
        <MemberIdentity member={member} variant={variant} />
      </AlephaContext.Provider>,
    );
  };

  it("renders the owner badge on the identity itself, with no hover card", async () => {
    const view = await mount(memberOf(true), "card");

    const identity = await screen.findByTestId("member-identity");
    expect(identity.textContent).toContain("nfo");
    expect(identity.textContent).toContain("Owner");
    expect(
      view.container.querySelector('[data-slot="hover-card-trigger"]'),
    ).toBeNull();
  });

  it("shows no badge for a plain member, and none at all when compact", async () => {
    await mount(memberOf(false), "card");
    expect(screen.queryByText("Owner")).toBeNull();
  });

  it("keeps the compact variant to the picture alone", async () => {
    await mount(memberOf(true), "compact");
    const identity = await screen.findByTestId("member-identity");
    expect(identity.textContent).toBe("");
  });
});
