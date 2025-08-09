import { useInject, useRouter, useStore } from "@alepha/react";
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
	const [project] = useStore("project");
	const { tr } = useI18n<I18n, "en">();

	if (auth.user) {
		return (
			<Popover
				position={"bottom"}
				content={
					<Menu>
						<MenuItem
							icon={"user"}
							text={tr("header.actions.profile")}
							onClick={() => {
								router.go("profile");
							}}
						/>
						<Divider />
						<MenuItem
							text={tr("header.actions.logout")}
							icon="log-out"
							onClick={() => auth.logout()}
						/>
					</Menu>
				}
			>
				<Action
					variant={"minimal"}
					endIcon={"caret-down"}
					icon={
						<img
							style={{
								height: "24px",
								width: "24px",
								borderRadius: "50%",
							}}
							src={"https://api.dicebear.com/9.x/pixel-art/svg?seed=Vivian"}
						/>
					}
				>
					{project ? (
						<Flex col>
							<Text bold style={{ textWrap: "nowrap" }}>
								{auth.user.name}
							</Text>
							<Text small>{tr("header.actions.profile.level", ["1"])}</Text>
						</Flex>
					) : (
						auth.user.name
					)}
				</Action>
			</Popover>
		);
	}

	return (
		<Action
			variant={"minimal"}
			icon={"user"}
			text={tr("header.actions.login")}
			visibleText={"md"}
			href={router.path("login", {
				query: {
					r: router.pathname,
				},
			})}
		/>
	);
};
