import { Button } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Home } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";
import LoreEmptyState from "./LoreEmptyState.tsx";

/**
 * Lore's full-page 404: the companion looking for the page (`seeking`, her
 * beam swept `around` since a full page has no list to look at), the number,
 * a sentence, and a way out.
 *
 * It replaces the framework's default `NotFound`, which stops at the
 * sentence. A member who reached it had no control on the screen, and a
 * refresh reloads a 404, so the app read as stuck (feedback #P2228).
 *
 * Mounted in two places, and sized for both the way `ErrorPage` is (its note
 * explains the `flex-1` / `h-svh` / `max-h-full` triplet): the root `/*`
 * page, straight into `#root`, and the project layout's error handler, since
 * `/:projectSlug` matches any unclaimed root path and a mistyped one fails
 * there rather than reaching `/*`.
 *
 * The numeral is the title, in its own large light figures: "404" is what a
 * reader recognises before any sentence, and the companion does not replace
 * it.
 *
 * ⚠️ Home is an anchor, not a click handler. The page is often reached from a
 * broken link, and the one control on it has to say where it goes and open in
 * a new tab like any other link.
 */
const NotFoundPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();

  return (
    <LoreEmptyState
      mood="seeking"
      look="around"
      className="h-svh max-h-full flex-1"
      title={
        <span className="block text-7xl leading-none font-extralight">404</span>
      }
      description={tr("notFound.title")}
    >
      <Button variant="outlined" href={router.path("home")}>
        <Home className="size-4" />
        {tr("error.home")}
      </Button>
    </LoreEmptyState>
  );
};

export default NotFoundPage;
