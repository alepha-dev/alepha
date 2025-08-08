import type React from "react";
import type { AnchorHTMLAttributes } from "react";
import { useRouter } from "../hooks/useRouter.ts";

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	to: string;
	children?: React.ReactNode;
}

const Link = (props: LinkProps) => {
	const router = useRouter();
	const { to, ...anchorProps } = props;

	return (
		<a {...router.anchor(to)} {...anchorProps}>
			{props.children}
		</a>
	);
};

export default Link;
