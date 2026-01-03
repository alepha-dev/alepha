import { useI18n } from "@alepha/react/i18n";
import { Link, NestedView, useRouter } from "@alepha/react/router";
import { DarkModeButton, Flex, LanguageButton } from "@alepha/ui";
import {
  AppShell,
  Button,
  Container,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import { IconChecklist, IconPlus } from "@tabler/icons-react";
import type { AppI18n } from "../AppI18n.ts";
import type { AppRouter } from "../AppRouter.ts";

const Layout = () => {
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<AppI18n, "en">();
  const { colorScheme } = useMantineColorScheme();

  return (
    <AppShell header={{ height: 60 }} padding="md" flex={1}>
      <AppShell.Header>
        <Container size="lg" h="100%">
          <Flex h="100%" align="center" justify="space-between">
            <Link href={router.path("home")} style={{ textDecoration: "none" }}>
              <Flex align="center" gap="xs">
                <IconChecklist size={28} />
                <Title order={3}>{tr("home.title")}</Title>
              </Flex>
            </Link>

            <Flex align="center" gap="sm">
              <Button
                component={Link}
                href={router.path("taskCreate")}
                size="sm"
                leftSection={<IconPlus size={16} />}
              >
                {tr("nav.addTask")}
              </Button>
              <LanguageButton />
              <DarkModeButton />
            </Flex>
          </Flex>
        </Container>
      </AppShell.Header>

      <AppShell.Main bg={colorScheme === "dark" ? "dark.8" : "gray.0"}>
        <Container size="lg" py="md">
          <NestedView />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
};

export default Layout;
