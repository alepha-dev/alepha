import { NestedView, useRouterEvents } from "@alepha/react";
import {
	AppShell,
	ColorSchemeScript,
	Container,
	MantineProvider,
	createTheme,
} from "@mantine/core";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { useMemo } from "react";
import Header from "./Header.tsx";

const Layout = () => {
	const theme = useMemo(() => {
		return createTheme({
			primaryColor: "orange",
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
				<AppShell header={{ height: 64 }}>
					<AppShell.Header>
						<Container size={"xl"} h={"100%"}>
							<Header />
						</Container>
					</AppShell.Header>
					<AppShell.Main>
						<Container size={"xl"}>
							<NestedView />
						</Container>
					</AppShell.Main>
				</AppShell>
			</MantineProvider>
		</>
	);
};

export default Layout;
