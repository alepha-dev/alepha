import { useAuth } from "@alepha/react/auth";
import { useI18n } from "@alepha/react/i18n";
import { useRouter } from "@alepha/react/router";
import {
  ActionButton,
  DarkModeButton,
  LanguageButton,
  ThemeButton,
} from "@alepha/ui";
import type { AuthRouter } from "@alepha/ui/auth";
import { Flex, Menu } from "@mantine/core";
import { IconLogout, IconSettings, IconUser } from "@tabler/icons-react";
import type { AppSecurityProvider } from "../../../../api/providers/AppSecurityProvider.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import type { MeRouter } from "../profile/MeRouter.ts";

const HeaderActions = () => {
  return (
    <Flex gap={"xs"} align="center" justify="center">
      <AuthButton />
      <ThemeButton />
      <LanguageButton actionProps={{ variant: "subtle" }} />
      <DarkModeButton actionProps={{ variant: "subtle" }} />
    </Flex>
  );
};

export default HeaderActions;

const AuthButton = () => {
  const auth = useAuth<AppSecurityProvider>();
  const meRouter = useRouter<MeRouter>();
  const authRouter = useRouter<AuthRouter>();
  const { tr } = useI18n<I18n, "en">();

  if (auth.user) {
    return (
      <Menu
        width={"196px"}
        arrowSize={12}
        trigger="click"
        position="bottom"
        withArrow
      >
        <Menu.Target>
          <ActionButton
            ta={"left"}
            variant={"subtle"}
            leftSection={
              auth.user.picture ? (
                <img
                  alt={"user avatar"}
                  style={{
                    height: "24px",
                    width: "24px",
                    borderRadius: "50%",
                  }}
                  src={`/api/files/${auth.user.picture}`}
                />
              ) : (
                <IconUser size={theme.icon.size.sm} />
              )
            }
          >
            {auth.user.username}
          </ActionButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{auth.user.email}</Menu.Label>
          <Menu.Item
            component={"a"}
            {...meRouter.anchor("profile")}
            leftSection={<IconSettings size={theme.icon.size.sm} />}
          >
            Settings
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            color={"red"}
            onClick={() => auth.logout()}
            leftSection={<IconLogout size={theme.icon.size.sm} />}
          >
            Sign out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  }

  return (
    <ActionButton
      style={{ textWrap: "nowrap" }}
      variant={"subtle"}
      leftSection={<IconUser />}
      href={authRouter.path("login", {
        query: {
          r: authRouter.pathname,
        },
      })}
    >
      {tr("header.actions.login")}
    </ActionButton>
  );
};
