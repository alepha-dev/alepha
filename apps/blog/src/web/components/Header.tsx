import { ActionButton, DarkModeButton, Flex, Text } from "@alepha/ui";
import { UserButton } from "@alepha/ui/auth";
import { ClientOnly } from "alepha/react";
import { useRouter } from "alepha/react/router";
import type { AppRouter } from "@/web/AppRouter.ts";

export type HeaderProps = {};

export const Header = (props: HeaderProps) => {
  const router = useRouter<AppRouter>();

  return (
    <Flex
      justify="space-between"
      align="center"
      p="md"
      rounded={"xl"}
      shadowed
      bordered
      mt={"xs"}
      maw={800}
      mx="auto"
      w="100%"
      surface
    >
      <ActionButton
        variant={"minimal"}
        variantActive={"minimal"}
        href={router.path("home")}
      >
        <Text size={"lg"}>Alepha Blog</Text>
      </ActionButton>
      <Flex gap="md" align="center">
        <ActionButton variant={"default"} target={"_blank"} href={"/rss.xml"}>
          RSS
        </ActionButton>
        <DarkModeButton />
        <ClientOnly>
          <UserButton />
        </ClientOnly>
      </Flex>
    </Flex>
  );
};
