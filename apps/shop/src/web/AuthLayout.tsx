import { NestedView } from "alepha/react/router";
import { Poincon } from "./components/Poincon.tsx";

/**
 * The shell for signing in.
 *
 * Deliberately not the storefront shell: a visitor on this screen is doing one
 * thing, and a header offering them the catalogue is an invitation to abandon it.
 * The atelier's mark is the only branding — enough to say where they are.
 */
export const AuthLayout = () => {
  return (
    <div className="bg-background flex min-h-dvh flex-col items-center justify-center p-5">
      <a href="/" className="mb-8 flex items-center gap-3">
        <Poincon titre="AA" />
        <span className="estampe text-sm">Atelier Aurore</span>
      </a>
      <div className="w-full max-w-md">
        <NestedView />
      </div>
    </div>
  );
};
