import type { CSSProperties } from "react";

export default function NotFoundPage(props: { style?: CSSProperties }) {
	return (
		<div
			style={{
				height: "100vh",
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				alignItems: "center",
				textAlign: "center",
				fontFamily: "sans-serif",
				padding: "1rem",
				...props.style,
			}}
		>
			<h1 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
				404 - This page does not exist
			</h1>
		</div>
	);
}
