import { Flex, Text } from "@alepha/mantine";
import { Card } from "@mantine/core";
import {
  IconAntenna,
  IconKey,
  IconMail,
  IconMapRoute,
  IconShield,
  IconUser,
} from "@tabler/icons-react";
import { useRouter } from "alepha/react/router";
import { theme } from "@/web/app/constants/theme.ts";
import MeLayoutNavLink from "./MeLayoutNavLink.tsx";
import type { MeRouter } from "./MeRouter.ts";

const MeLayoutMenu = () => {
  const meRouter = useRouter<MeRouter>();

  return (
    <Card
      withBorder
      bg={theme.colors.app}
      p={"xs"}
      w={{
        base: "100%",
        md: "196px",
      }}
    >
      <Flex
        flex={1}
        gap={"xs"}
        direction={{
          base: "row",
          md: "column",
        }}
      >
        <Text visibleFrom={"md"} size="xs">
          General
        </Text>
        <MeLayoutNavLink
          leftSection={<IconUser size={20} />}
          href={meRouter.path("profile")}
        >
          Profile
        </MeLayoutNavLink>
        <MeLayoutNavLink
          leftSection={<IconMapRoute size={20} />}
          href={meRouter.path("characters")}
        >
          Campaigns
        </MeLayoutNavLink>
        <MeLayoutNavLink
          leftSection={<IconMail size={20} />}
          href={meRouter.path("invitations")}
        >
          Invitations
        </MeLayoutNavLink>
        <Text visibleFrom={"md"} size="xs">
          Security
        </Text>
        <MeLayoutNavLink
          leftSection={<IconShield size={20} />}
          href={meRouter.path("identities")}
        >
          Identities
        </MeLayoutNavLink>
        <MeLayoutNavLink
          leftSection={<IconAntenna size={20} />}
          href={meRouter.path("sessions")}
        >
          Sessions
        </MeLayoutNavLink>
        <MeLayoutNavLink
          leftSection={<IconKey size={20} />}
          href={meRouter.path("apiKeys")}
        >
          API Keys
        </MeLayoutNavLink>
      </Flex>
    </Card>
  );
};

export default MeLayoutMenu;
