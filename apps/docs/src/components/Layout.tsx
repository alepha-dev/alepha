import { NestedView, useRouterEvents } from "@alepha/react";
import { AppShell, Flex, MantineProvider, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
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

	const [opened, { toggle }] = useDisclosure();

	return (
		<MantineProvider
			defaultColorScheme="dark"
			theme={{
				fontFamily: "Inter",
				primaryColor: "gray",
			}}
		>
			<NavigationProgress />
			<AppShell
				padding="md"
				withBorder={false}
				className={"graph-paper"}
				header={{ height: { base: 48, sm: 60, lg: 76 } }}
				footer={{ height: 32 }}
				navbar={{
					width: 300,
					breakpoint: "sm",
					collapsed: { mobile: !opened },
				}}
			>
				<AppShell.Header>
					<Header opened={opened} toggle={toggle} />
				</AppShell.Header>
				<AppShell.Navbar>
					<Sidebar />
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
								Made with ❤️ by Alepha
							</Text>
						</Flex>
					</Flex>
				</AppShell.Footer>
			</AppShell>
		</MantineProvider>
	);
};

export default Layout;
