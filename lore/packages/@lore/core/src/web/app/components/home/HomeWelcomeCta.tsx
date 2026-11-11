import { Button } from "@alepha/ui";
import { Link } from "alepha/react/router";
import { LogIn, Plus } from "lucide-react";

export interface HomeWelcomeCtaProps {
  createPath: string;
  createLabel: string;
  createIcon?: "create" | "signIn";
  createDisabled?: boolean;
  createDisabledLabel?: string;
  /**
   * A line under the button, explaining a state the button cannot. Today
   * that is only "signups are closed": without it, a welcome whose call to
   * action quietly became Sign in looks like a page that lost a button.
   */
  note?: string;
  loginPath?: string;
  alreadyRegistered: string;
  /**
   * Stretch the button to the full width: the phone's bottom bar.
   */
  block?: boolean;
}

/**
 * The welcome page's one call to action, with the lines that explain it.
 * Drawn twice by `HomeWelcome`: under the pitch from `md` up, and in a bar
 * pinned to the bottom of a phone screen, where a thumb reaches it.
 */
const HomeWelcomeCta = (props: HomeWelcomeCtaProps) => {
  // Plus is "make something new". A sign-in button that wears it promises
  // the wrong thing.
  const Icon = props.createIcon === "signIn" ? LogIn : Plus;
  const size = props.block ? "h-12 w-full" : "h-12 px-10";

  return (
    <div
      className={`flex flex-col gap-2 ${props.block ? "items-stretch text-center" : "items-start"}`}
    >
      {props.createDisabled ? (
        <Button size="lg" disabled className={`${size} text-base`}>
          <Icon className="size-5" />
          {props.createLabel}
        </Button>
      ) : (
        <Button
          href={props.createPath}
          size="lg"
          className={`${size} text-base`}
        >
          <Icon className="size-5" />
          {props.createLabel}
        </Button>
      )}
      {props.createDisabled && props.createDisabledLabel && (
        <span className="text-muted-foreground text-xs">
          {props.createDisabledLabel}
        </span>
      )}
      {props.note && (
        <span className="text-muted-foreground max-w-md text-xs">
          {props.note}
        </span>
      )}
      {props.loginPath && (
        <Link
          href={props.loginPath}
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          {props.alreadyRegistered}
        </Link>
      )}
    </div>
  );
};

export default HomeWelcomeCta;
