import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "../UserAvatar.tsx";

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

  it("serves a file id through the authenticated file route", () => {
    const { container } = render(
      <UserAvatar fileId="00000000-0000-4000-8000-00000000000a" />,
    );

    expect(img(container)?.getAttribute("src")).toBe(
      "/api/files/00000000-0000-4000-8000-00000000000a",
    );
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
});
