import { useHead } from "@alepha/react-head";

const App = () => {
	const [, setHead] = useHead({
		title: "1",
	});
	return (
		<div>
			Hello
			<button
				onClick={() => {
					setHead((t) => ({
						title: `${Number(t?.title) + 1}`,
					}));
				}}
			>
				Change Title
			</button>
		</div>
	);
};

export default App;
