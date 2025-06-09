import { NestedView } from "@alepha/react";
import {
	AppShell,
	Container,
	MantineProvider,
	createTheme,
} from "@mantine/core";
import Header from "./Header.tsx";

const theme = createTheme({
	fontFamily: "Open Sans, sans-serif",
	primaryColor: "violet",
});

const Layout = () => {
	return (
		<MantineProvider theme={theme}>
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
	);
};

export default Layout;
