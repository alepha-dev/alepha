import { useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { useI18n } from "@alepha/react-i18n";
import { ActionIcon, Flex, Menu, useMantineColorScheme } from "@mantine/core";
import {
	IconLogout,
	IconMoon,
	IconSettings,
	IconUser,
} from "@tabler/icons-react";
import type { AppRouter } from "../../AppRouter.ts";
import type { Security } from "../../api/providers/Security.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import type { MeRouter } from "../auth/MeRouter.ts";
import Action from "../ui/Action.tsx";

const HeaderActions = () => {
	const { toggleColorScheme } = useMantineColorScheme();
	return (
		<Flex gap={"xs"} align="center" justify="center">
			<AuthButton />
			<ActionIcon size={"lg"} variant={"subtle"} onClick={toggleColorScheme}>
				<IconMoon />
			</ActionIcon>
		</Flex>
	);
};

export default HeaderActions;

const AuthButton = () => {
	const auth = useAuth<Security>();
	const router = useRouter<AppRouter>();
	const routerMe = useRouter<MeRouter>();
	const { tr } = useI18n<I18n, "en">();

	if (auth.user) {
		return (
			<Menu
				width={"196px"}
				arrowSize={12}
				trigger="click"
				position="bottom"
				withArrow
			>
				<Menu.Target>
					<Action
						ta={"left"}
						variant={"subtle"}
						leftSection={
							auth.user.picture ? (
								<img
									alt={"picture"}
									style={{
										height: "24px",
										width: "24px",
										borderRadius: "50%",
									}}
									src={auth.user.picture}
								/>
							) : (
								<IconUser size={theme.icon.size.sm} />
							)
						}
					>
						{auth.user.name}
					</Action>
				</Menu.Target>
				<Menu.Dropdown>
					<Menu.Label>{auth.user.email}</Menu.Label>
					<Menu.Item
						component={"a"}
						{...routerMe.anchor("profile")}
						leftSection={<IconSettings size={theme.icon.size.sm} />}
					>
						Settings
					</Menu.Item>
					<Menu.Divider />
					<Menu.Item
						color={"red"}
						onClick={() => auth.logout()}
						leftSection={<IconLogout size={theme.icon.size.sm} />}
					>
						Sign out
					</Menu.Item>
				</Menu.Dropdown>
			</Menu>
		);
	}

	return (
		<Action
			style={{ textWrap: "nowrap" }}
			variant={"subtle"}
			leftSection={<IconUser />}
			href={router.path("login", {
				query: {
					r: router.pathname,
				},
			})}
		>
			{tr("header.actions.login")}
		</Action>
	);
};
