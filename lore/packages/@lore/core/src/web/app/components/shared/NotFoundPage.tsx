import { Button } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Home } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";

/**
 * Lore's full-page 404: the number, a sentence, and a way out.
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
 * ⚠️ Home is an anchor, not a click handler. The page is often reached from a
 * broken link, and the one control on it has to say where it goes and open in
 * a new tab like any other link.
 */
const NotFoundPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();

  return (
    <div className="flex h-svh max-h-full flex-1 items-center justify-center p-8">
      <div className="flex flex-col items-center justify-center gap-4 text-center">
        <div className="text-8xl leading-none font-extralight">404</div>
        <div className="text-muted-foreground text-sm">
          {tr("notFound.title")}
        </div>
        <Button variant="outlined" href={router.path("home")}>
          <Home className="size-4" />
          {tr("error.home")}
        </Button>
      </div>
    </div>
  );
};

export default NotFoundPage;
