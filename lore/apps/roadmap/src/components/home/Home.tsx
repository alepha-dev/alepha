import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import type { I18n } from "../../services/I18n.ts";

const Home = () => {
	const { tr } = useI18n<I18n, "en">();
	return (
		<Flex>
			<Flex pad2 col centerX fill>
				<Flex col centerX>
					<Text bold large>
						{tr("roadmap.home.title")}
					</Text>
					<Text muted small>
						{tr("roadmap.home.subtitle")}
					</Text>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Home;
