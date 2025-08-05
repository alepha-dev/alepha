import { Flex, Text } from "@alepha/react-flex";
import { useI18n } from "@alepha/react-i18n";
import type { I18n } from "../../services/I18n.ts";
import HeaderActions from "./HeaderActions.tsx";
import StupidLogo from "./StupidLogo.tsx";

const Header = () => {
	const { tr } = useI18n<I18n, "en">();

	return (
		<Flex col>
			<Flex
				visible={"md"}
				pad1
				card
				bordered
				style={{
					borderTop: 0,
					borderLeft: 0,
					borderRight: 0,
				}}
			></Flex>
			<Flex
				bordered
				centerY
				style={{
					height: 64,
					borderTop: 0,
					borderLeft: 0,
					borderRight: 0,
				}}
				col
				pad1
				gap1
			>
				<Flex wFill pad2h>
					<Flex fill gap1>
						<Flex center gap1>
							<StupidLogo />
							<Flex col>
								<Text bold large>
									{tr("roadmap.title")}
									<Text small muted italic style={{ fontWeight: 300 }}>
										v0.0.1
									</Text>
								</Text>
								<Text muted style={{ marginTop: -4, fontSize: 10 }}>
									{tr("roadmap.subtitle")}
								</Text>
							</Flex>
						</Flex>
					</Flex>
					<HeaderActions />
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Header;
