import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import type { I18n } from "../../services/I18n.ts";
import Action from "../shared/Action.tsx";

const Home = () => {
	const { tr } = useI18n<I18n, "en">();
	return (
		<Flex fill center col gap2>
			<Flex col center>
				<Text bold large>
					{tr("roadmap.home.title")}
				</Text>
				<Text muted small>
					{tr("roadmap.home.subtitle")}
				</Text>
			</Flex>
			<Flex style={{ width: 1, height: 16 }} bordered />
			<Action
				variant={"outlined"}
				link={{ to: "/p/1" }}
				text={"Explore Alepha Project"}
			/>
		</Flex>
	);
};

export default Home;
