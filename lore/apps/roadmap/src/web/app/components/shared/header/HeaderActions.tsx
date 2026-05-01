import { ButtonDark } from "@alepha/ui/components/button-dark";
import { ButtonLanguage } from "@alepha/ui/components/button-language";
import { ButtonTheme } from "@alepha/ui/components/button-theme";
import { ButtonUser } from "@alepha/ui/components/button-user";
import { DropdownMenuItem } from "@alepha/ui/components/ui/dropdown-menu";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { UserCircle2 } from "lucide-react";
import type { I18n } from "../../../services/I18n.ts";

export type HeaderActionsProps = {};

const HeaderActions = (_props: HeaderActionsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const auth = useAuth();
  const router = useRouter();

  const goLogin = () => router.push(router.path("login"));
  const goAdmin = () => router.push("/admin");
  const goProfile = () => router.push("me");

  return (
    <div className="flex items-center gap-1">
      <ButtonLanguage label={tr("header.actions.language" as never)} />
      <ButtonTheme />
      <ButtonDark />
      <ButtonUser onSignIn={goLogin}>
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
