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
import HeaderConnectionsChip from "./HeaderConnectionsChip.tsx";

const HeaderActions = () => {
  const { tr } = useI18n<I18n, "en">();
  const auth = useAuth();
  const router = useRouter();

  const goLogin = () => router.push(router.path("login"));
  const goAdmin = () => router.push("/admin");
  const goProfile = () => router.push("me");

  return (
    <div className="bg-background flex items-center gap-1 rounded-md border p-1">
      <HeaderConnectionsChip />
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
