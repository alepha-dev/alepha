import {
  DarkModeButton,
  Flex,
  LanguageButton,
  ThemeButton,
} from "@alepha/mantine";
import { UserButton } from "@alepha/mantine/auth";
import { useI18n } from "alepha/react/i18n";
import type { I18n } from "@/web/app/services/I18n.ts";

const HeaderActions = () => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <Flex gap={"xs"} align="center" justify="center">
      <UserButton loginLabel={tr("header.actions.login")} bd={0} />
      <ThemeButton bd={0} expert />
      <LanguageButton bd={0} />
      <DarkModeButton bd={0} />
    </Flex>
  );
};

export default HeaderActions;
