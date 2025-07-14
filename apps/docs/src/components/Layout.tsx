import { NestedView, useRouterEvents } from "@alepha/react";
import {
	AppShell,
	ColorSchemeScript,
	Flex,
	MantineProvider,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { theme } from "../config/theme.ts";
import Header from "./Header.tsx";
import Sidebar from "./Sidebar.tsx";

const Layout = () => {
	useRouterEvents({
		onBegin: () => {
			nprogress.start();
		},
		onEnd: () => {
			nprogress.complete();
		},
	});

	return (
		<>
			<ColorSchemeScript defaultColorScheme="auto" />
			<MantineProvider defaultColorScheme="auto" theme={theme.mantine}>
				<NavigationProgress />
				<Main />
			</MantineProvider>
		</>
	);
};

export default Layout;

const Main = () => {
	const [opened, { toggle }] = useDisclosure();

	return (
		<AppShell
			padding="md"
			withBorder={false}
			header={{ height: theme.headerHeight }}
			footer={{ height: theme.footerHeight }}
			navbar={{
				width: theme.sidebarWidth,
				breakpoint: theme.sidebarBreakpoint,
				collapsed: { mobile: !opened },
			}}
		>
			<AppShell.Header>
				<Header opened={opened} toggle={toggle} />
			</AppShell.Header>
			<AppShell.Navbar>
				<Sidebar toggle={toggle} />
			</AppShell.Navbar>
			<AppShell.Main mih={"auto"}>
				<NestedView />
			</AppShell.Main>
			<AppShell.Footer>
				<Flex justify={"space-between"} align={"center"} h={"100%"} px={"xs"}>
					<Flex flex={1} justify={"flex-start"}>
						<Text size={"xs"} c={"dimmed"}>
							Alepha Docs
						</Text>
					</Flex>
					<Flex justify={"flex-end"}>
						<Text size={"xs"} c={"dimmed"}>
							{`Last update - ${new Date(import.meta.env.VITE_BUILD_DATE).toLocaleString()}`}
						</Text>
					</Flex>
				</Flex>
			</AppShell.Footer>
		</AppShell>
	);
};
