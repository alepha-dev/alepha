interface ModuleProps {
	data: any;
}

const Module = (props: ModuleProps) => {
	return <pre>{JSON.stringify(props, null, "  ")}</pre>;
};

export default Module;
