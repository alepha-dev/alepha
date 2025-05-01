import { useState } from "react";

const Home = () => {
	const [a, setA] = useState("0");

	return (
		<div>
			Home Page :)zzz
			<br />
			<input value={a} onChange={(e) => setA(e.target.value)} />
		</div>
	);
};

export default Home;
