import { ActionButton, Flex } from "@alepha/ui";
import { useRouter } from "alepha/react/router";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import HeaderProjectActions from "../../project/ProjectActions.tsx";
import RoadmapLogo from "../RoadmapLogo.tsx";
import HeaderActions from "./HeaderActions.tsx";
import HeaderKanbanCreateButton from "./HeaderKanbanCreateButton.tsx";
import HeaderMobileQuestLog from "./HeaderMobileQuestLog.tsx";
import HeaderProject from "./HeaderProject.tsx";

const Header = () => {
  const router = useRouter<AppRouter>();

  return (
    <Flex
      direction={"column"}
      p={"xs"}
      px={"md"}
      gap={"xs"}
      h={64}
      align="center"
      justify="center"
    >
      <Flex w={"100%"} px={2}>
        <Flex gap={"xs"}>
          <Flex align="center" justify="center" gap={"xs"}>
            <HeaderMobileQuestLog />
            <Flex>
              <ActionButton
                variant={"minimal"}
                href={router.path("home")}
                active={false}
                leftSection={<RoadmapLogo />}
              />
            </Flex>
            <HeaderProject />
          </Flex>
        </Flex>
        <Flex px={"sm"} flex={1} align="center" justify="center">
          <Flex visibleFrom={"lg"} maw={"900px"}>
            <HeaderProjectActions />
          </Flex>
        </Flex>
        <Flex align="center" justify="end" gap="xs">
          <HeaderKanbanCreateButton />
          <HeaderActions />
        </Flex>
      </Flex>
    </Flex>
  );
};

export default Header;
