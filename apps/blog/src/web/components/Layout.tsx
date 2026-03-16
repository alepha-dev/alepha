import { AlephaMantineProvider, Flex } from "@alepha/ui";
import { NestedView } from "alepha/react/router";
import { Footer } from "./Footer.tsx";
import { Header } from "./Header.tsx";

const Layout = () => {
  return (
    <AlephaMantineProvider>
      <Flex direction="column" mih="100vh">
        <Header />
        <Flex
          direction="column"
          style={{ flex: 1 }}
          maw={800}
          mx="auto"
          w="100%"
          p="md"
        >
          <NestedView />
        </Flex>
        <Footer />
      </Flex>
    </AlephaMantineProvider>
  );
};

export default Layout;
