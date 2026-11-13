import { fireEvent, render, screen } from "@testing-library/react";
import { expectAccessible } from "alepha/testing/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "../UserAvatar.tsx";
import { userAvatarTone } from "../userInitials.ts";

/**
 * `user.picture` is a file id in the `avatars` bucket, or an absolute URL:
 * an account created before OAuth sign-up imported the provider's picture,
 * a picture passed to the register endpoint, or a user from an external
 * issuer. #Q2406: the URL was handed to the file route as an id, so a user
 * who signed in with Google requested `/api/files/https://…`, got a 404,
 * and was drawn as the fallback glyph on every page.
 */
describe("UserAvatar", () => {
  const img = (container: HTMLElement) => container.querySelector("img");

  it("serves a file id through the authenticated file route", async () => {
    const { container } = render(
      <UserAvatar fileId="00000000-0000-4000-8000-00000000000a" />,
    );

    expect(img(container)?.getAttribute("src")).toBe(
      "/api/files/00000000-0000-4000-8000-00000000000a",
    );
    // axe: an avatar image (#Q3338).
    await expectAccessible();
    // Same-origin: nothing to withhold.
    expect(img(container)?.getAttribute("referrerpolicy")).toBeNull();
  });

  it("serves a file id through the public route when asked", () => {
    const { container } = render(
      <UserAvatar public fileId="00000000-0000-4000-8000-00000000000b" />,
    );

    expect(img(container)?.getAttribute("src")).toBe(
      "/api/public/files/00000000-0000-4000-8000-00000000000b",
    );
  });

  it("draws an absolute URL as-is, with no referrer, whichever route was asked for", () => {
    const url = "https://lh3.googleusercontent.com/a/face=s96-c";

    for (const isPublic of [false, true]) {
      const { container, unmount } = render(
        <UserAvatar public={isPublic} fileId={url} />,
      );

      expect(img(container)?.getAttribute("src")).toBe(url);
      // The provider learns the viewer's address, which loading from it
      // cannot avoid, but not which page of the app they were on.
      expect(img(container)?.getAttribute("referrerpolicy")).toBe(
        "no-referrer",
      );
      unmount();
    }
  });

  it("falls back when a URL picture fails to load", () => {
    const { container } = render(
      <UserAvatar
        fileId="https://lh3.googleusercontent.com/a/expired"
        fallback={<span data-testid="initial">A</span>}
      />,
    );

    fireEvent.error(img(container)!);

    expect(img(container)).toBeNull();
    expect(container.querySelector('[data-testid="initial"]')).not.toBeNull();
  });

  it("treats anything that is not http(s) as a file id", () => {
    // A `javascript:` or `data:` value is not a URL this component will
    // point an image at: it stays a (missing) file id and 404s harmlessly.
    const { container } = render(<UserAvatar fileId="javascript:alert(1)" />);

    expect(img(container)?.getAttribute("src")).toBe(
      "/api/files/javascript:alert(1)",
    );
  });

  /**
   * #Q3577: every user has an avatar, the picture when there is one, else
   * two initials on a colour of the user's own.
   */
  describe("with a user and no picture", () => {
    const ada = {
      id: "0192e4c4-0000-7000-8000-000000000001",
      firstName: "Ada",
      lastName: "Lovelace",
    };

    it("draws the initials, named for a screen reader, with no file request", () => {
      const { container } = render(<UserAvatar user={ada} />);

      const avatar = screen.getByRole("img", { name: "Ada Lovelace" });
      expect(avatar.textContent).toBe("AL");
      // The letters are hidden: a screen reader says the name, not "A L".
      expect(avatar.querySelector('[aria-hidden="true"]')?.textContent).toBe(
        "AL",
      );
      // No picture, no `<img>`: nothing asks `/api/files`.
      expect(img(container)).toBeNull();
    });

    it("wears the colour of the user's id, whatever their name", () => {
      const tone = userAvatarTone(ada.id).split(" ")[0];
      const first = render(<UserAvatar user={ada} />);
      expect(first.container.firstElementChild?.classList.contains(tone)).toBe(
        true,
      );
      first.unmount();

      const renamed = render(
        <UserAvatar user={{ ...ada, firstName: "Augusta" }} />,
      );
      expect(
        renamed.container.firstElementChild?.classList.contains(tone),
      ).toBe(true);
    });

    it("draws the picture when there is one, and none for fileId null", () => {
      const withPicture = {
        ...ada,
        picture: "00000000-0000-4000-8000-0000000000aa",
      };
      const shown = render(<UserAvatar user={withPicture} />);
      expect(img(shown.container)?.getAttribute("src")).toBe(
        "/api/files/00000000-0000-4000-8000-0000000000aa",
      );
      shown.unmount();

      const off = render(<UserAvatar user={withPicture} fileId={null} />);
      expect(img(off.container)).toBeNull();
      expect(off.container.textContent).toBe("AL");
    });

    it("falls back to the initials when the picture fails to load", () => {
      const { container } = render(
        <UserAvatar
          user={{ ...ada, picture: "https://lh3.googleusercontent.com/a/x" }}
        />,
      );
      fireEvent.error(img(container)!);
      expect(container.textContent).toBe("AL");
    });

    it("keeps the glyph when there is nothing to draw initials from", () => {
      const { container } = render(<UserAvatar user={{ id: ada.id }} />);
      expect(container.querySelector("svg")).not.toBeNull();
    });
  });
});
