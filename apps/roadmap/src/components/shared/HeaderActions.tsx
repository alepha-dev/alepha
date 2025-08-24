import { useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { useI18n } from "@alepha/react-i18n";
import { ActionIcon, Flex, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconUser } from "@tabler/icons-react";
import type { AppRouter } from "../../AppRouter.ts";
import type { Security } from "../../api/providers/Security.ts";
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
			<Action
				ta={"left"}
				variant={"subtle"}
				href={routerMe.path("profile")}
				active={{
					startWith: true,
				}}
				leftSection={
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
				{auth.user.name}
			</Action>
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
