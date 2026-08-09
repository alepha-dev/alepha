import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { ArrowLeft, Heart, Home, RotateCw } from "lucide-react";
import type { I18n } from "../../services/I18n.ts";

/**
 * Full-page error boundary, returned by the router's error handler in
 * production.
 *
 * The height triplet is load-bearing, because the handler is declared on the
 * root layout but replaces whichever layer actually threw — so this component
 * mounts either straight into `#root` (a plain block of auto height) or into
 * one of the project shell's flex columns, and it has to centre its card in
 * both without ever making the page taller than its container.
 *
 * - `flex-1` covers the flex-column parents: basis 0 plus grow means the page
 *   is exactly the space left under the header, padding included.
 * - `h-svh` covers the block parent, where `flex-1` is inert and would
 *   otherwise collapse to content height, leaving the card at the top of an
 *   empty screen.
 * - `max-h-full` is what stops the two from fighting: inside a parent with a
 *   resolved height it caps the viewport height that `h-svh` asks for, which
 *   is where the spurious scrollbar came from; against the auto-height block
 *   parent the percentage is indefinite, so it resolves to `none` and leaves
 *   `h-svh` alone.
 */
const ErrorPage = () => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div className="flex h-svh max-h-full flex-1 items-center justify-center">
      <div className="flex flex-col items-center justify-center gap-4">
        <div className="text-muted-foreground">
          <Heart className="size-12" />
        </div>
        <div className="flex flex-col items-center justify-center gap-1">
          <span className="text-lg font-bold">{tr("error.title")}</span>
          <span className="text-muted-foreground text-sm">
            {tr("error.description")}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="size-4" />
            {tr("error.back")}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RotateCw className="size-4" />
            {tr("error.reload")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            <Home className="size-4" />
            {tr("error.home")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ErrorPage;
