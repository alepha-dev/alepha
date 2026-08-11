import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { DropdownMenuItem } from "@alepha/ui/components/ui/dropdown-menu";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { UserCircle2 } from "lucide-react";
import type { I18n } from "../../../services/I18n.ts";

const HeaderActions = () => {
  const { tr } = useI18n<I18n, "en">();
  const auth = useAuth();
  const router = useRouter();

  const goLogin = () => router.push(router.path("login"));
  const goAdmin = () => router.push("/admin");
  const goProfile = () => router.push("me");

  return (
    // Search is NOT here. It moved out to `ProjectView`'s topbar, left of
    // Create Quest, as an input-shaped trigger — this cluster is small,
    // ambient controls (language, theme, account), and a field-sized element
    // read as one of them. `HeaderActions` also renders off-project via
    // `PageHeader`, where search has nothing to search anyway.
    //
    // No box: the icons already read as a group by proximity, and the outline
    // made them look like a toolbar widget parked beside the Create Quest
    // button. `border` was the reported offender but all four classes made the
    // box, so they go together — `rounded-md` draws nothing once the border is
    // gone, and `bg-background` already matched the AppShell header's own
    // background (`headerOutside` is false here), so it was invisible anyway.
    <div className="flex items-center gap-1">
      <ButtonLanguage variant="ghost" label={tr("header.actions.language")} />
      <ButtonTheme variant="ghost" />
      <ButtonDark variant="ghost" />
      <ButtonUser
        variant="ghost"
        onSignIn={goLogin}
        signInLabel={tr("header.actions.login")}
      >
        <ButtonUser.Email />
        <ButtonUser.AdminMenuItem
          label={tr("header.actions.admin" as never)}
          onClick={goAdmin}
        />
        {auth.user && (
          <DropdownMenuItem onClick={goProfile}>
            <UserCircle2 className="size-4" />
            {tr("header.actions.profile")}
          </DropdownMenuItem>
        )}
        <ButtonUser.LogoutMenuItem label={tr("header.actions.logout")} />
      </ButtonUser>
    </div>
  );
};

export default HeaderActions;
