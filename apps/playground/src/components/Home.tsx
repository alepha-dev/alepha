import { t } from "@alepha/core";
import { useForm } from "@alepha/react-form";
import { DarkModeButton, Flex, TypeForm, useToast } from "@alepha/ui";

const Home = () => {
  const toast = useToast();
  const form = useForm({
    schema: t.partial(
      t.object({
        firstName: t.text({
          $control: {
            select: {},
          },
        }),
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
        <DarkModeButton mode={"minimal"} />
      </Flex>
      <Flex p={"lg"}>
        <TypeForm form={form} />
      </Flex>
    </Flex>
  );
};

export default Home;
