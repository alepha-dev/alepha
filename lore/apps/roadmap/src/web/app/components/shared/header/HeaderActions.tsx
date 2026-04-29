import { LanguageToggle } from "@alepha/ui/components/language-toggle";
import { ThemeToggle } from "@alepha/ui/components/theme-toggle";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { LogIn, LogOut, User } from "lucide-react";
import type { I18n } from "../../../services/I18n.ts";
import { ThemePicker } from "../ThemePicker.tsx";

export type HeaderActionsProps = {};

const HeaderActions = (_props: HeaderActionsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const auth = useAuth();
  const router = useRouter();

  if (!auth.user) {
    return (
      <div className="flex items-center gap-1">
        <LanguageToggle />
        <ThemePicker />
        <ThemeToggle mode="toggle" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(router.path("login"))}
          className="gap-2"
        >
          <LogIn className="size-4" />
          {tr("header.actions.login")}
        </Button>
      </div>
    );
  }

  const displayName =
    auth.user.username ?? auth.user.email ?? auth.user.id ?? "User";

  return (
    <div className="flex items-center gap-1">
      <ThemePicker />
      <ThemeToggle mode="toggle" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <User className="size-4" />
            <span className="hidden sm:inline">{displayName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => auth.logout()}>
            <LogOut className="size-4" />
            {tr("header.actions.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default HeaderActions;
