import { useInject, useRouter, useStore } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Button, Divider, Menu, MenuItem, Popover } from "@blueprintjs/core";
import {
	Blank,
	CaretDown,
	LogOut,
	Moon,
	Tick,
	Translate,
	User,
} from "@blueprintjs/icons";
import type { AppRouter } from "../../AppRouter.ts";
import type { Security } from "../../api/providers/Security.ts";
import type { I18n } from "../../services/I18n.ts";
import { Level } from "../../services/Level.ts";
import { Theme } from "../../services/Theme.ts";
import Action from "./Action.tsx";

const HeaderActions = () => {
	const theme = useInject(Theme);
	const { tr, setLang, lang, languages } = useI18n<I18n, "en">();

	return (
		<Flex gap1 center>
			{/*<Flex visible={"xl"}>*/}
			{/*	<Popover*/}
			{/*		position={"bottom"}*/}
			{/*		content={*/}
			{/*			<Menu>*/}
			{/*				{languages.map((key) => (*/}
			{/*					<MenuItem*/}
			{/*						icon={lang === key ? <Tick /> : <Blank />}*/}
			{/*						key={key}*/}
			{/*						text={tr(key)}*/}
			{/*						onClick={() => {*/}
			{/*							setLang(key);*/}
			{/*						}}*/}
			{/*					/>*/}
			{/*				))}*/}
			{/*			</Menu>*/}
			{/*		}*/}
			{/*	>*/}
			{/*		<Button icon={<Translate />} variant={"minimal"} />*/}
			{/*	</Popover>*/}
			{/*</Flex>*/}
			<AuthButton />
			<Button
				size={"large"}
				icon={<Moon />}
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
	const auth = useAuth<Security>();
	const router = useRouter<AppRouter>();
	const [character] = useStore("character");
	const lvl = useInject(Level);
	const { tr } = useI18n<I18n, "en">();

	if (auth.user) {
		return (
			<Popover
				position={"bottom"}
				content={
					<Menu>
						<MenuItem
							icon={<User />}
							text={tr("header.actions.profile")}
							onClick={() => {
								router.go("profile");
							}}
						/>
						<Divider />
						<MenuItem
							text={tr("header.actions.logout")}
							icon={<LogOut />}
							onClick={() => auth.logout()}
						/>
					</Menu>
				}
			>
				<Action
					variant={"minimal"}
					endIcon={<CaretDown />}
					icon={
						<img
							alt={"picture"}
							style={{
								height: "24px",
								width: "24px",
								borderRadius: "50%",
							}}
							src={"https://api.dicebear.com/9.x/pixel-art/svg?seed=Vivian"}
						/>
					}
				>
					{character ? (
						<Flex col>
							<Text bold style={{ textWrap: "nowrap" }}>
								{auth.user.name}
							</Text>
							<Text small>
								{tr("header.actions.profile.level", [
									String(lvl.getLevelByXp(character.xp)),
								])}
							</Text>
						</Flex>
					) : (
						<Text bold style={{ textWrap: "nowrap" }}>
							{auth.user.name}
						</Text>
					)}
				</Action>
			</Popover>
		);
	}

	return (
		<Action
			style={{ textWrap: "nowrap" }}
			variant={"minimal"}
			icon={<User />}
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
