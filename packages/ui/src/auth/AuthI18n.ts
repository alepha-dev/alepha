import { $dictionary } from "@alepha/react/i18n";

export class AuthI18n {
  en = $dictionary({
    name: "alepha.ui.auth.en",
    lazy: () => ({
      default: {
        loginSignIn: "Sign in",
        loginContinueWith: "Continue with $1",
        loginOr: "OR",
        loginCancel: "Cancel",
        loginForgotPassword: "Forgot password?",
        loginNoAccount: "Don't have an account?",
        loginSignUp: "Sign up",
        loginUsername: "Username",
        loginEmail: "Email",
        loginPhone: "Phone number",
        loginPassword: "Password",
        registerCreateAccount: "Create account",
        registerContinueWith: "Continue with $1",
        registerOr: "OR",
        registerCancel: "Cancel",
        registerHaveAccount: "Already have an account?",
        registerSignIn: "Sign in",
        registerUsername: "Username",
        registerEmail: "Email",
        registerPhone: "Phone number",
        registerPassword: "Password",
        registerConfirmPassword: "Confirm password",
        registerDisabled:
          "Registration is not available. Please contact your administrator.",
        registerBackToSignIn: "Back to sign in",
        registerVerifyTitle: "Verify your account",
        registerVerifyDescription:
          "Please enter the verification code(s) sent to you.",
        registerEmailCode: "Email verification code",
        registerPhoneCode: "Phone verification code",
        registerVerifySubmit: "Complete Registration",
        registerVerifyBack: "Back to registration",
        resetPasswordTitle: "Reset password",
        resetPasswordEmail: "Email",
        resetPasswordEnterEmail:
          "Enter your email address to reset your password",
        resetPasswordSendCode: "Send verification code",
        resetPasswordCodeSent: "We've sent a verification code to your email.",
        resetPasswordEnterCode: "Enter the 6-digit code",
        resetPasswordResendCode: "Resend code",
        resetPasswordEnterNewPassword: "Create your new password",
        resetPasswordNewPassword: "New password",
        resetPasswordConfirmPassword: "Confirm password",
        resetPasswordSetNewPassword: "Set new password",
        resetPasswordSuccess: "Your password has been reset successfully.",
        resetPasswordBackToSignIn: "Back to sign in",
        resetPasswordCancel: "Cancel",
        resetPasswordDisabled:
          "Password reset is not available. Please contact your administrator.",
      },
    }),
  });

  fr = $dictionary({
    lazy: () => ({
      default: {
        loginSignIn: "Se connecter",
        loginContinueWith: "Continuer avec $1",
        loginOr: "OU",
        loginCancel: "Annuler",
        loginForgotPassword: "Mot de passe oublié ?",
        loginNoAccount: "Vous n'avez pas de compte ?",
        loginSignUp: "S'inscrire",
        loginUsername: "Nom d'utilisateur",
        loginEmail: "E-mail",
        loginPhone: "Numéro de téléphone",
        loginPassword: "Mot de passe",
        registerCreateAccount: "Créer un compte",
        registerContinueWith: "Continuer avec $1",
        registerOr: "OU",
        registerCancel: "Annuler",
        registerHaveAccount: "Vous avez déjà un compte ?",
        registerSignIn: "Se connecter",
        registerUsername: "Nom d'utilisateur",
        registerEmail: "E-mail",
        registerPhone: "Numéro de téléphone",
        registerPassword: "Mot de passe",
        registerConfirmPassword: "Confirmer le mot de passe",
        registerDisabled:
          "L'inscription n'est pas disponible. Veuillez contacter votre administrateur.",
        registerBackToSignIn: "Retour à la connexion",
        registerVerifyTitle: "Vérifiez votre compte",
        registerVerifyDescription:
          "Veuillez entrer le(s) code(s) de vérification qui vous ont été envoyés.",
        registerEmailCode: "Code de vérification par e-mail",
        registerPhoneCode: "Code de vérification par téléphone",
        registerVerifySubmit: "Terminer l'inscription",
        registerVerifyBack: "Retour à l'inscription",
        resetPasswordTitle: "Réinitialiser le mot de passe",
        resetPasswordEmail: "E-mail",
        resetPasswordEnterEmail:
          "Entrez votre adresse e-mail pour réinitialiser votre mot de passe",
        resetPasswordSendCode: "Envoyer le code de vérification",
        resetPasswordCodeSent:
          "Nous avons envoyé un code de vérification à votre e-mail.",
        resetPasswordEnterCode: "Entrez le code à 6 chiffres",
        resetPasswordResendCode: "Renvoyer le code",
        resetPasswordEnterNewPassword: "Créez votre nouveau mot de passe",
        resetPasswordNewPassword: "Nouveau mot de passe",
        resetPasswordConfirmPassword: "Confirmer le mot de passe",
        resetPasswordSetNewPassword: "Définir le nouveau mot de passe",
        resetPasswordSuccess:
          "Votre mot de passe a été réinitialisé avec succès.",
        resetPasswordBackToSignIn: "Retour à la connexion",
        resetPasswordCancel: "Annuler",
        resetPasswordDisabled:
          "La réinitialisation du mot de passe n'est pas disponible. Veuillez contacter votre administrateur.",
      },
    }),
  });
}
