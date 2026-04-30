import { useAuth } from "alepha/react/auth";
import { useRouter } from "alepha/react/router";
import type { GettingStartedSlide } from "./GettingStarted.tsx";

/**
 * Hook that provides the auth slide content.
 * Content changes based on whether user is logged in.
 * Returns undefined if auth routes are not configured.
 */
export const useAuthSlide = (): GettingStartedSlide | undefined => {
  const { user, logout } = useAuth();
  const router = useRouter();

  // Check if auth routes exist
  const hasAuth = router.pages.find((it) => it.name === "authLayout");
  if (!hasAuth) {
    return undefined;
  }

  // User is logged in - show user info and logout option
  if (user) {
    return {
      text: "Welcome back!",
      sub: `You're signed in as ${user.email || user.username || "user"}.`,
      steps: [
        {
          num: "✓",
          text: "Authentication is working correctly",
        },
        {
          num: "→",
          text: (
            <>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  logout();
                }}
              >
                Sign out
              </a>{" "}
              to test the login flow
            </>
          ),
        },
      ],
    };
  }

  // User is not logged in - show signup instructions
  const authAnchorProps = router.anchor(router.path("login"));

  return {
    text: "Who are you?",
    sub: "Create your first account.",
    steps: [
      {
        num: "1",
        text: (
          <>
            Sign up at <a {...authAnchorProps}>/auth/login</a>
          </>
        ),
      },
      {
        num: "2",
        text: (
          <>
            Customize in <code>src/api/AppSecurity.ts</code>
          </>
        ),
      },
    ],
  };
};
