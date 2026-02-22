import { Heading } from "@alepha/ui";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

const DemoHeading = () => {
  return (
    <Showcase title="Flex" schema={t.object({})} initialValues={{}}>
      {(props) => <Heading title={"Hello!"} />}
    </Showcase>
  );
};

export default DemoHeading;
