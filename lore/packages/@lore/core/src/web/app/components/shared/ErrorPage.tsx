import { Button } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { ArrowLeft, Home, RotateCw } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";
import LoreEmptyState from "./LoreEmptyState.tsx";

/**
 * Full-page error boundary, returned by the router's error handler in
 * production: the companion in her `glitch` mood (a wing down, the lens
 * red), what went wrong, and three ways out.
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
    <LoreEmptyState
      mood="glitch"
      className="h-svh max-h-full flex-1"
      title={tr("error.title")}
      description={tr("error.description")}
    >
      <Button variant="outlined" onClick={() => window.history.back()}>
        <ArrowLeft className="size-4" />
        {tr("error.back")}
      </Button>
      <Button variant="outlined" onClick={() => window.location.reload()}>
        <RotateCw className="size-4" />
        {tr("error.reload")}
      </Button>
      <Button
        variant="outlined"
        onClick={() => {
          window.location.href = "/";
        }}
      >
        <Home className="size-4" />
        {tr("error.home")}
      </Button>
    </LoreEmptyState>
  );
};

export default ErrorPage;
