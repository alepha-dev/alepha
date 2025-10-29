import { t } from "@alepha/core";
import { useForm } from "@alepha/react-form";
import { DarkModeButton, Flex, TypeForm, useToast } from "@alepha/ui";

const Home = (props: { pong: boolean }) => {
  const toast = useToast();
  const form = useForm({
    schema: t.partial(
      t.object({
        firstName: t.text({}),
        lastName: t.text(),
        email: t.email(),
        password: t.text(),
        birthday: t.date(),
        status: t.enum(["active", "inactive", "pending", "banned", "deleted"]),
        tags: t.array(t.string({ enum: ["tech", "news", "blog"] })),
        keywords: t.array(t.string()),
      }),
    ),
    handler: (values, args) => {
      console.log("Form submitted with values:", values);
      toast.success({
        title: "Form Submitted",
        message: `Hello, ${values.firstName} ${values.lastName}!`,
      });
    },
  });

  return (
    <Flex p={"lg"} direction={"column"}>
      <Flex>
        <h1>Playground</h1>
        <p>
          {props.pong
            ? " - Pong received from API!"
            : " - No response from API."}
        </p>
      </Flex>
      <Flex>
        <DarkModeButton mode={"segmented"} />
      </Flex>
      <Flex p={"lg"}>
        <TypeForm form={form} />
      </Flex>
    </Flex>
  );
};

export default Home;
