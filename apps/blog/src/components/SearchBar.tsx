import { Code, TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";

const SearchBar = () => {
	return (
		<TextInput
			radius={"xl"}
			placeholder={"Search"}
			leftSection={<IconSearch size={16} />}
			rightSection={<Code />}
		/>
	);
};

export default SearchBar;
