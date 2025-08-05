import { Flex } from "@alepha/react-flex";
import styles from "./StupidLogo.module.css";

const StupidLogo = () => {
	return (
		<Flex style={{ position: "relative" }}>
			<Flex
				gap1
				style={{
					transform: "rotate(90deg) scale(0.8)",
					position: "absolute",
				}}
			>
				<Flex className={styles.LogoBar} style={{ width: "2px" }} />
				<Flex className={styles.LogoBar} style={{ width: "3px" }} />
				<Flex className={styles.LogoBar} style={{ width: "4px" }} />
				<Flex className={styles.LogoBar} style={{ width: "2px" }} />
			</Flex>
			<Flex gap1 style={{ transform: "rotate(-16deg) scale(0.8)" }}>
				<Flex className={styles.LogoBar} style={{ width: "2px" }} />
				<Flex className={styles.LogoBar} style={{ width: "3px" }} />
				<Flex className={styles.LogoBar} style={{ width: "4px" }} />
				<Flex className={styles.LogoBar} style={{ width: "2px" }} />
			</Flex>
		</Flex>
	);
};

export default StupidLogo;
