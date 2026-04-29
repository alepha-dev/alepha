import type { VerifyEmailStep } from "@alepha/mantine/auth";
import { VerifyEmail } from "@alepha/mantine/auth";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

const showcaseSchema = t.object({
  step: t.string({
    title: "Step",
    default: "success",
    enum: ["verifying", "success", "error"],
  }),
});

const DemoVerifyEmail = () => {
  return (
    <Showcase
      title="VerifyEmail"
      schema={showcaseSchema}
      initialValues={{
        step: "success",
      }}
      columns={1}
    >
      {(values) => <VerifyEmail step={values.step as VerifyEmailStep} />}
    </Showcase>
  );
};

export default DemoVerifyEmail;
