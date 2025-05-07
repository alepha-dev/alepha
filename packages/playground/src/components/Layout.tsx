import { Link, NestedView, useInject, useRouterEvents } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { AppShell, Burger, MantineProvider } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { StrictMode } from "react";
import { App } from "../App.ts";

const Layout = () => {
	useRouterEvents({
		onBegin: () => nprogress.start(),
		onEnd: () => nprogress.complete(),
	});
	const [opened, { toggle }] = useDisclosure();
	const auth = useAuth();
	const routes = useInject(App);

	return (
		<StrictMode>
			<MantineProvider defaultColorScheme="dark">
				<NavigationProgress />
				<AppShell
					header={{ height: 60 }}
					navbar={{
						width: 300,
						breakpoint: "sm",
						collapsed: { mobile: !opened },
					}}
					padding="md"
				>
					<AppShell.Header>
						<Burger
							opened={opened}
							onClick={toggle}
							hiddenFrom="sm"
							size="sm"
						/>
						<div>Logo</div>
					</AppShell.Header>
					<AppShell.Navbar p="xs">
						<ul>
							<li>
								<Link to="/">Home</Link>
							</li>
							<li>
								<Link to={routes.test} />
							</li>
							{!auth.user && (
								<li>
									<button onClick={() => auth.login()}>login</button>
								</li>
							)}
							{auth.user && <li>{auth.user.name}</li>}
							{auth.user && (
								<li>
									<button onClick={() => auth.logout()}>logout</button>
								</li>
							)}
						</ul>
					</AppShell.Navbar>

					<AppShell.Main>
						<NestedView />
					</AppShell.Main>
				</AppShell>
			</MantineProvider>
		</StrictMode>
	);
};

export default Layout;
