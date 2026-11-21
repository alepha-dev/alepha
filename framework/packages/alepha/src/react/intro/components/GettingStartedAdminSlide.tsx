import { useAuth } from "alepha/react/auth";
import { useRouter } from "alepha/react/router";

import type { GettingStartedSlide } from "./GettingStarted.tsx";

/**
 * Hook that provides the admin slide content.
 * Content changes based on user status and admin permissions.
 * Returns undefined if admin routes are not configured.
 */
export const useAdminSlide = (): GettingStartedSlide | undefined => {
  const { user, has } = useAuth();
  const router = useRouter<any>();

  // Check if admin routes exist
  const hasAdmin = router.pages.find((it) => it.name === "admin");
  if (!hasAdmin) {
    return undefined;
  }

  const adminPath = router.path("admin");
  const adminAnchorProps = router.anchor(adminPath);

  // The scaffold's `src/api/Realm.ts` reads `adminEmails` from `ADMIN_EMAIL`.
  const adminEmailStep = (
    <>
      Set <code>ADMIN_EMAIL</code> in <code>.env</code> to your email:{" "}
      <code>adminEmails</code> in <code>src/api/Realm.ts</code> reads it
    </>
  );
  const canAccessAdmin = has("admin:*");

  // User is admin - show success message
  if (canAccessAdmin) {
    return {
      text: "You're in control.",
      sub: "Admin access granted.",
      steps: [
        {
          num: "✓",
          text: "You have admin privileges",
        },
        {
          num: "→",
          text: (
            <>
              Go to <a {...adminAnchorProps}>{adminPath}</a> to manage your
              application
            </>
          ),
        },
      ],
    };
  }

  // User is logged in but not admin - show how to become admin
  if (user) {
    return {
      text: "Take the wheel.",
      sub: "Become admin in two steps.",
      steps: [
        {
          num: "1",
          text: adminEmailStep,
        },
        {
          num: "2",
          text: (
            <>
              Go to <a {...adminAnchorProps}>{adminPath}</a>
            </>
          ),
        },
      ],
    };
  }

  // User is not logged in - show full instructions
  return {
    text: "Take the wheel.",
    sub: "Become admin in three steps.",
    steps: [
      {
        num: "1",
        text: adminEmailStep,
      },
      { num: "2", text: "Create a user account with that email" },
      {
        num: "3",
        text: (
          <>
            Go to <a {...adminAnchorProps}>{adminPath}</a>
          </>
        ),
      },
    ],
  };
};
