import { useInject, useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Button, Divider, Menu, MenuItem, Popover } from "@blueprintjs/core";
import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import { Theme } from "../../services/Theme.ts";
import Action from "./Action.tsx";

const HeaderActions = () => {
	const theme = useInject(Theme);
	const { tr, setLang, lang, languages } = useI18n<I18n, "en">();

	return (
		<Flex gap1 center>
			<Flex visible={"xl"}>
				<Popover
					position={"bottom"}
					content={
						<Menu>
							{languages.map((key) => (
								<MenuItem
									icon={lang === key ? "tick" : "blank"}
									key={key}
									text={tr(key)}
									onClick={() => {
										setLang(key);
									}}
								/>
							))}
						</Menu>
					}
				>
					<Button icon={"translate"} variant={"minimal"} />
				</Popover>
			</Flex>
			<AuthButton />
			<Button
				icon={"moon"}
				variant={"minimal"}
				onClick={() => {
					theme.toggleColorScheme();
				}}
			></Button>
		</Flex>
	);
};

export default HeaderActions;

const AuthButton = () => {
	const auth = useAuth();
	const router = useRouter<AppRouter>();

	if (auth.user) {
		return (
			<Popover
				position={"bottom"}
				content={
					<Menu>
						<MenuItem icon={"user"} text={"Profile"} />
						<Divider />
						<MenuItem
							text="Logout"
							icon="log-out"
							onClick={() => auth.logout()}
						/>
					</Menu>
				}
			>
				<Action variant={"minimal"} endIcon={"caret-down"}>
					<Flex gap1>
						<Flex centerX>
							<img
								style={{
									height: "24px",
									width: "24px",
									borderRadius: "50%",
								}}
								src={
									"https://avatars.githubusercontent.com/u/46966636?s=48&v=4"
								}
							/>
						</Flex>
						<Flex col>
							<Text bold style={{ textWrap: "nowrap" }}>
								{auth.user.name}
							</Text>
							<Text small>Level 1</Text>
						</Flex>
					</Flex>
				</Action>
			</Popover>
		);
	}

	return (
		<Action
			variant={"minimal"}
			icon={"user"}
			text={"Sign in"}
			link={{
				to: router.path("login", {
					query: {
						r: router.pathname,
					},
				}),
			}}
		/>
	);
};
