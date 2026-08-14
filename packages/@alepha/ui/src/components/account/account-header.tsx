import { AppActions } from "@alepha/ui/components/app-actions/app-actions";
import { Button } from "@alepha/ui/components/ui/button";
import { Link, useRouter } from "alepha/react/router";
import { ArrowLeft } from "lucide-react";

export interface AccountHeaderProps {
  /**
   * Route name the back link points at.
   *
   * @default "home"
   */
  homeRouteName?: string;

  /**
   * Label for the back link.
   *
   * @default "Back to site"
   */
  backLabel?: string;
}

/**
 * The account area's top bar: a way out on the left, the ambient controls on
 * the right.
 *
 * The way out is the point. `/account` is a destination you arrive at from
 * somewhere else and leave again, and unlike `/admin` it has no sidebar to
 * carry a brand or a home affordance — without this the only exit is the
 * browser's back button.
 *
 * It is a real `<Link href>`, not a button that calls `router.push`, so the
 * middle-click / open-in-new-tab / copy-link behaviours all work and the
 * destination is visible in the status bar on hover.
 *
 * Replaceable wholesale: `AccountRouterOptions.header` overrides this, for an
 * application whose account area sits inside its own chrome and needs no
 * second header.
 */
export const AccountHeader = (props: AccountHeaderProps) => {
  const router = useRouter<any>();
  const home = props.homeRouteName ?? "home";

  return (
    <div className="flex items-center justify-between gap-4 border-b pb-3">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground hover:text-foreground"
        render={<Link href={router.path(home)} />}
      >
        <ArrowLeft className="size-4" />
        {props.backLabel ?? "Back to site"}
      </Button>
      <AppActions />
    </div>
  );
};
