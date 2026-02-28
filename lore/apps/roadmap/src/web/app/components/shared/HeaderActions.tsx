import {
  type ActionMenuItem,
  DarkModeButton,
  Flex,
  LanguageButton,
  ThemeButton,
} from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { IconSettings } from "@tabler/icons-react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import type { AppSecurityProvider } from "../../../../api/providers/AppSecurityProvider.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import type { MeRouter } from "../profile/MeRouter.ts";

const HeaderActions = () => {
  const items: ActionMenuItem[] = [];
  const auth = useAuth<AppSecurityProvider>();
  const meRouter = useRouter<MeRouter>();
  const { tr } = useI18n<I18n, "en">();

  if (auth.user) {
    items.push({
      label: tr("header.actions.profile"),
      icon: <IconSettings size={theme.icon.size.sm} />,
      onClick: () => meRouter.push("profile"),
    });
  }

  return (
    <Flex gap={"xs"} align="center" justify="center">
      <UserButton
        loginLabel={tr("header.actions.login")}
        menuItems={items}
        skipProfile
        bd={0}
      />
      <ThemeButton bd={0} expert />
      <LanguageButton bd={0} />
      <DarkModeButton bd={0} />
    </Flex>
  );
};

export default HeaderActions;
