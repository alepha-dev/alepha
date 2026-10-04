import { $env, $hook, $inject, z } from "alepha";
import { UserService } from "alepha/api/users";
import { $logger } from "alepha/logger";

/**
 * Creates the one account the test app is driven with, on every boot, unless
 * it exists already.
 *
 * The address and password are invented and only ever reach a local database:
 * the app is never deployed. Both can be moved through the environment.
 */
export class TestUserSeed {
  protected readonly log = $logger();
  protected readonly users = $inject(UserService);

  protected readonly env = $env(
    z.object({
      MOBILE_TEST_EMAIL: z.text({
        default: "test@mobile.test",
        description: "Address of the seeded test account.",
      }),
      MOBILE_TEST_PASSWORD: z.text({
        default: "Mobile-test-1",
        description: "Password of the seeded test account.",
      }),
    }),
  );

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      const email = this.env.MOBILE_TEST_EMAIL;
      const { content } = await this.users.findUsers({ emails: [email] });
      if (content.length > 0) return;

      await this.users.createUser({ email, username: "test" }, undefined, {
        password: this.env.MOBILE_TEST_PASSWORD,
      });
      this.log.info("Seeded the test account", { email });
    },
  });
}
