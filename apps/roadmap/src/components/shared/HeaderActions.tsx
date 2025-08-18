import { useInject, useRouter } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import { Button } from "@blueprintjs/core";
import { Moon, User } from "@blueprintjs/icons";
import type { AppRouter } from "../../AppRouter.ts";
import type { Security } from "../../api/providers/Security.ts";
import type { I18n } from "../../services/I18n.ts";
import { Theme } from "../../services/Theme.ts";
import type { MeRouter } from "../auth/MeRouter.ts";
import Action from "./Action.tsx";

const HeaderActions = () => {
	const theme = useInject(Theme);
	return (
		<Flex gap1 center>
			<AuthButton />
			<Button
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
	const routerMe = useRouter<MeRouter>();
	const { tr } = useI18n<I18n, "en">();

	if (auth.user) {
		return (
			<Action
				alignText={"left"}
				variant={"minimal"}
				href={routerMe.path("profile")}
				useActiveOptions={{
					startWith: true,
				}}
				visibleText={"md"}
				text={auth.user.name}
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
			/>
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
