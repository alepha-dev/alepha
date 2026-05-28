export interface RegisterIntent {
  /**
   * I18n key for the banner shown on the register form.
   */
  messageKey: string;
  /**
   * URL to redirect to after a successful registration (passed via the existing `?r=` query param).
   */
  redirectTo: string;
}

export const registerIntents: Record<string, RegisterIntent> = {
  createCampaign: {
    messageKey: "auth.register.intent.createCampaign",
    redirectTo: "/?action=createCampaign",
  },
};

export const resolveRegisterIntent = (
  intent: string | undefined,
): RegisterIntent | undefined => (intent ? registerIntents[intent] : undefined);
