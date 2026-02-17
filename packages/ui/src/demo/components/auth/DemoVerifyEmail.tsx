import { VerifyEmail } from "@alepha/ui/auth";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

const showcaseSchema = t.object({
  placeholder: t.boolean({
    title: "Demo Mode",
    default: true,
    $control: { switch: true },
  }),
});

const DemoVerifyEmail = () => {
  return (
    <Showcase
      title="VerifyEmail"
      schema={showcaseSchema}
      initialValues={{
        placeholder: true,
      }}
      columns={1}
    >
      {() => <VerifyEmail />}
    </Showcase>
  );
};

export default DemoVerifyEmail;
