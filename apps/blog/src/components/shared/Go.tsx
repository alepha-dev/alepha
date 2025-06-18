import { useActive, useRouter, type VirtualRouter } from "@alepha/react";
import { Button, type ButtonProps } from "@mantine/core";

const Go = <T extends object>(
	props: ButtonProps & {
		to: keyof VirtualRouter<T>;
		params?: Record<string, any>;
		skipActiveCheck?: boolean;
	},
) => {
	const { to, params: _params, skipActiveCheck, ...restProps } = props;

	const router = useRouter();
	const anchorProps = router.anchor<T>(to, props);
	const { isActive } = useActive(anchorProps.href);

	return (
		<Button
			component="a"
			disabled={!skipActiveCheck && isActive}
			{...restProps}
			{...anchorProps}
		/>
	);
};

export default Go;
