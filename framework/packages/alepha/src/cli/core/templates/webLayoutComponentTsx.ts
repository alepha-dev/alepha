/**
 * The saas preset's layout: the providers `@alepha/ui` needs around every
 * page, and the user button.
 *
 * `DialogProvider` is not decoration. It is where `useDialog()` confirms are
 * drawn, and where every settings dialog is (the account dialog opens over
 * the page, from the user menu or a `?account=<section>` link). The user
 * button is the way in: sign in when nobody is signed in, the account and
 * sign-out otherwise.
 */
export const webLayoutComponentTsx = () => {
  return `import { DialogProvider, Toaster, TooltipProvider } from "@alepha/ui";
import { ButtonUser } from "@alepha/ui/shell";
import { NestedView } from "alepha/react/router";

const Layout = () => {
  return (
    <TooltipProvider>
      <DialogProvider>
        <header className="flex justify-end p-4">
          <ButtonUser />
        </header>
        <NestedView />
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default Layout;
`;
};
