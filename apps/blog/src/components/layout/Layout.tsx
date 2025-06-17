import { NestedView, useRouterEvents } from "@alepha/react";
import {
	AppShell,
	ColorSchemeScript,
	Container,
	Flex,
	MantineProvider,
	Text,
	createTheme,
} from "@mantine/core";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { useMemo } from "react";
import Header from "./Header.tsx";

const Layout = () => {
	const theme = useMemo(() => {
		return createTheme({
			primaryColor: "gray",
			primaryShade: 9,
		});
	}, []);

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
			<MantineProvider theme={theme} defaultColorScheme="auto">
				<NavigationProgress />
				<AppShell
					className={"graph-paper"}
					header={{ height: 64 }}
					footer={{ height: 48 }}
				>
					<AppShell.Header>
						<Container size={"xl"} h={"100%"}>
							<Header />
						</Container>
					</AppShell.Header>
					<AppShell.Main mih={"auto"}>
						<Container size={"xl"}>
							<NestedView />
						</Container>
					</AppShell.Main>
					<AppShell.Footer>
						<Container size={"xl"}>
							<Flex p={"md"} justify={"space-between"} align={"center"}>
								<Flex flex={1} justify={"flex-start"}>
									<Text size={"xs"} c={"dimmed"}>
										Alepha.js Blog
									</Text>
								</Flex>
								<Flex justify={"flex-end"}>
									<Text size={"xs"} c={"dimmed"}>
										Made with ❤️ by Alepha.js
									</Text>
								</Flex>
							</Flex>
						</Container>
					</AppShell.Footer>
				</AppShell>
			</MantineProvider>
		</>
	);
};

export default Layout;
