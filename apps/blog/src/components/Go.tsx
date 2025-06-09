import { type VirtualRouter, useActive, useRouter } from "@alepha/react";
import { Button, type ButtonProps } from "@mantine/core";

const Go = <T extends object>(
	props: ButtonProps & {
		to: keyof VirtualRouter<T>;
		params?: Record<string, any>;
	},
) => {
	const router = useRouter();
	const anchorProps = router.anchor<T>(props.to, props);
	const { isActive } = useActive(anchorProps.href);

	return (
		<Button component="a" disabled={isActive} {...props} {...anchorProps} />
	);
};

export default Go;
