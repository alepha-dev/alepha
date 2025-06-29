export default function NotFoundPage() {
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
			}}
		>
			<h1 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
				This page does not exist
			</h1>
		</div>
	);
}
