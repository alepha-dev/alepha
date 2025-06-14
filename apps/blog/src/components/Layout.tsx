import { NestedView } from "@alepha/react";
import {
	AppShell,
	ColorSchemeScript,
	Container,
	MantineProvider,
	createTheme,
} from "@mantine/core";
import { useMemo } from "react";
import Header from "./Header.tsx";

const Layout = () => {
	const theme = useMemo(() => {
		return createTheme({});
	}, []);

	return (
		<>
			<ColorSchemeScript defaultColorScheme="auto" />
			<MantineProvider theme={theme} defaultColorScheme="auto">
				<AppShell header={{ height: 60 }}>
					<AppShell.Header>
						<Container h={"100%"}>
							<Header />
						</Container>
					</AppShell.Header>
					<AppShell.Main>
						<Container className="main-container">
							<NestedView />
						</Container>
					</AppShell.Main>
				</AppShell>
			</MantineProvider>
		</>
	);
};

export default Layout;
