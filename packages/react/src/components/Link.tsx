import type { AnchorHTMLAttributes } from "react";
import { useRouter } from "../hooks/useRouter.ts";

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	href: string;
}

const Link = (props: LinkProps) => {
	const router = useRouter();

	return (
		<a {...props} {...router.anchor(props.href)}>
			{props.children}
		</a>
	);
};

export default Link;
