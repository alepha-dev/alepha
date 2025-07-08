import { NestedView, useRouterEvents } from "@alepha/react";
import {
	AppShell,
	Burger,
	Flex,
	Image,
	MantineProvider,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
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
		<MantineProvider defaultColorScheme="auto">
			<NavigationProgress />
			<AppShell
				className={"graph-paper"}
				header={{ height: 64 }}
				footer={{ height: 48 }}
				navbar={{
					width: 256,
					breakpoint: "sm",
					collapsed: { mobile: !opened },
				}}
			>
				<AppShell.Header>
					<Flex h={"100%"} align={"center"} px={"lg"} gap={"sm"}>
						<Burger
							opened={opened}
							onClick={toggle}
							size="sm"
							hiddenFrom={"sm"}
						/>
						<Flex>
							<Image src={"/logo.png"} alt={"logo"} width={64} height={64} />
						</Flex>
						<Flex></Flex>
						<Text size={"xl"}>Alepha Docs</Text>
					</Flex>
				</AppShell.Header>
				<AppShell.Navbar>
					<Sidebar />
				</AppShell.Navbar>
				<AppShell.Main mih={"auto"}>
					<NestedView />
				</AppShell.Main>
				<AppShell.Footer>
					<Flex p={"md"} justify={"space-between"} align={"center"}>
						<Flex flex={1} justify={"flex-start"}>
							<Text size={"xs"} c={"dimmed"}>
								Alepha Docs
							</Text>
						</Flex>
						<Flex justify={"flex-end"}>
							<Text size={"xs"} c={"dimmed"}>
								Made with ❤️ by Alepha.js
							</Text>
						</Flex>
					</Flex>
				</AppShell.Footer>
			</AppShell>
		</MantineProvider>
	);
};

export default Layout;
