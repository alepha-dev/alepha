import { t } from "@alepha/core";
import { useForm } from "@alepha/react-form";
import { DarkModeButton, Flex, TypeForm, useToast } from "@alepha/ui";

const Home = () => {
  const toast = useToast();
  const form = useForm({
    schema: t.partial(
      t.object({
        firstName: t.text(),
        lastName: t.text(),
        email: t.email(),
        password: t.text(),
        birthday: t.date(),
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
        <DarkModeButton mode={"segmented"} />
      </Flex>
      <Flex p={"lg"}>
        <TypeForm form={form} />
      </Flex>
    </Flex>
  );
};

export default Home;
