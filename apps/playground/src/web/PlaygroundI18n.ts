import { $dictionary } from "alepha/react/i18n";

/**
 * Two dictionaries — `en` (default) and `fr`. The English keys document
 * the contract; the French keys override the registry components'
 * built-in `default` strings via the global `tr()` lookup.
 */
export class PlaygroundI18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        // Top-bar / Home
        "language.en": "English",
        "language.fr": "Français",
        "home.welcome": "Welcome to the Alepha Playground 👋",
        "home.signedOut":
          "Register or log in to explore the admin shell. Use admin@alepha.dev for an account that's auto-promoted to admin.",
        "home.signedIn": "Hi $1, you're signed in.",
        "home.openAdmin": "Open admin",
        "home.demoGallery": "Demo gallery",
        "home.signIn": "Sign in",
        "home.register": "Register",
      },
    }),
  });

  fr = $dictionary({
    lazy: async () => ({
      default: {
        // Top-bar / Home
        "language.en": "English",
        "language.fr": "Français",
        "home.welcome": "Bienvenue sur le Playground Alepha 👋",
        "home.signedOut":
          "Inscris-toi ou connecte-toi pour explorer l'admin. Utilise admin@alepha.dev pour un compte auto-promu admin.",
        "home.signedIn": "Salut $1, tu es connecté.",
        "home.openAdmin": "Ouvrir l'admin",
        "home.demoGallery": "Galerie de démos",
        "home.signIn": "Se connecter",
        "home.register": "S'inscrire",

        // ── Auth ───────────────────────────────────────────────────────
        "auth.login.email": "Email",
        "auth.login.phone": "Téléphone",
        "auth.login.username": "Nom d'utilisateur",
        "auth.login.identifier": "Email, nom d'utilisateur ou téléphone",
        "auth.login.password": "Mot de passe",
        "auth.login.submit": "Se connecter",
        "auth.login.forgot": "Mot de passe oublié ?",
        "auth.login.or": "OU",
        "auth.login.continueWith": "Continuer avec $1",
        "auth.login.noAccount": "Pas encore de compte ?",
        "auth.login.signUp": "S'inscrire",
        "auth.login.invalid": "Identifiant ou mot de passe invalide",
        "auth.login.cancel": "Annuler",

        "auth.register.passwordsMismatch":
          "Les mots de passe ne correspondent pas",
        "auth.register.verifyTitle": "Vérifie ton compte",
        "auth.register.verifyHint":
          "Saisis le(s) code(s) de vérification reçu(s).",
        "auth.register.verifyFailed": "Échec de la vérification",
        "auth.register.emailCode": "Code de vérification email",
        "auth.register.phoneCode": "Code de vérification téléphone",
        "auth.register.verifySubmit": "Terminer l'inscription",
        "auth.register.verifyBack": "Retour à l'inscription",
        "auth.register.disabled":
          "L'inscription n'est pas disponible. Contacte ton administrateur.",
        "auth.register.backToSignIn": "Retour à la connexion",
        "auth.register.username": "Nom d'utilisateur",
        "auth.register.email": "Email",
        "auth.register.phone": "Téléphone",
        "auth.register.password": "Mot de passe",
        "auth.register.confirmPassword": "Confirme le mot de passe",
        "auth.register.submit": "Créer le compte",
        "auth.register.or": "OU",
        "auth.register.continueWith": "Continuer avec $1",
        "auth.register.haveAccount": "Tu as déjà un compte ?",
        "auth.register.signIn": "Se connecter",
        "auth.register.cancel": "Annuler",

        "auth.reset.title": "Réinitialiser le mot de passe",
        "auth.reset.passwordsMismatch":
          "Les mots de passe ne correspondent pas",
        "auth.reset.invalidState": "État de réinitialisation invalide",
        "auth.reset.resendFailed": "Échec du renvoi du code",
        "auth.reset.disabled":
          "La réinitialisation n'est pas disponible. Contacte ton administrateur.",
        "auth.reset.backToSignIn": "Retour à la connexion",
        "auth.reset.email": "Email",
        "auth.reset.emailHint":
          "Saisis ton adresse email pour réinitialiser ton mot de passe",
        "auth.reset.sendCode": "Envoyer le code de vérification",
        "auth.reset.codeSent":
          "Nous avons envoyé un code de vérification à ton email.",
        "auth.reset.codeLabel": "Saisis le code à 6 chiffres",
        "auth.reset.continue": "Continuer",
        "auth.reset.resend": "Renvoyer le code",
        "auth.reset.newPasswordHint": "Crée ton nouveau mot de passe",
        "auth.reset.newPassword": "Nouveau mot de passe",
        "auth.reset.confirmPassword": "Confirme le mot de passe",
        "auth.reset.setPassword": "Définir le nouveau mot de passe",
        "auth.reset.success":
          "Ton mot de passe a été réinitialisé avec succès.",
        "auth.reset.cancel": "Annuler",

        "auth.verify.invalidLink":
          "Lien de vérification invalide. L'email et le jeton sont requis.",
        "auth.verify.failed":
          "Échec de la vérification. Le lien a peut-être expiré ou est invalide.",
        "auth.verify.verifying": "Vérification de ton email…",
        "auth.verify.verifyingHint":
          "Patiente pendant que nous vérifions ton adresse email.",
        "auth.verify.successTitle": "Email vérifié",
        "auth.verify.success": "Ton email a été vérifié avec succès.",
        "auth.verify.signIn": "Se connecter à ton compte",
        "auth.verify.errorTitle": "Échec de la vérification de l'email",
        "auth.verify.backToSignIn": "Retour à la connexion",

        // ── Auto-form bottom bar ──────────────────────────────────────
        "autoForm.cancel": "Annuler",
        "autoForm.reset": "Réinitialiser",
        "autoForm.save": "Enregistrer",
        "autoForm.errors": "Erreurs",
        "autoForm.error": "Erreur",
        "autoForm.formLabel": "Formulaire",

        // ── Control-array / object / upload ───────────────────────────
        "controlArray.add": "Ajouter",
        "controlArray.remove": "Supprimer",
        "controlArray.moveUp": "Monter",
        "controlArray.moveDown": "Descendre",
        "controlArray.collapse": "Réduire",
        "controlArray.expand": "Développer",
        "controlArray.deleteTitle": "Supprimer l'élément",
        "controlArray.deleteConfirm": "Supprimer cet élément ?",
        "controlArray.cancel": "Annuler",
        "controlArray.delete": "Supprimer",

        "controlObject.initialize": "Initialiser",
        "controlObject.clear": "Vider",
        "controlObject.collapse": "Réduire",
        "controlObject.expand": "Développer",

        "controlUpload.singleOnly": "Un seul fichier autorisé",
        "controlUpload.tooBig": "$1 dépasse $2",
        "controlUpload.uploadedOne": "Fichier téléversé",
        "controlUpload.uploadedMany": "$1 fichiers téléversés",
        "controlUpload.failed": "Échec du téléversement : $1",
        "controlUpload.remove": "Supprimer",
        "controlUpload.uploading": "Téléversement…",
        "controlUpload.chooseFile": "Choisir un fichier",
        "controlUpload.chooseFiles": "Choisir des fichiers",
        "controlUpload.dragDrop": "ou glisse-dépose ici",
        "controlUpload.max": "max $1",

        // ── Admin Users ───────────────────────────────────────────────
        "admin.users.thisUser": "cet utilisateur",
        "admin.users.cantDisableSelf":
          "Tu ne peux pas désactiver ton propre compte",
        "admin.users.enableTitle": "Activer l'utilisateur",
        "admin.users.disableTitle": "Désactiver l'utilisateur",
        "admin.users.enableConfirm": "Activer $1 ?",
        "admin.users.disableConfirm":
          "Désactiver $1 ? Il ne pourra plus se connecter.",
        "admin.users.enabled": "Utilisateur activé",
        "admin.users.disabled": "Utilisateur désactivé",
        "admin.users.deleteTitle": "Supprimer l'utilisateur",
        "admin.users.deleteConfirm":
          "Supprimer définitivement $1 ? Cette action est irréversible.",
        "admin.users.deleted": "Utilisateur supprimé",
        "admin.users.noneSelected": "Aucun utilisateur actif sélectionné",
        "admin.users.bulkDisableTitle": "Désactiver les utilisateurs",
        "admin.users.bulkDisableConfirm":
          "Désactiver $1 utilisateur(s) ? Ils ne pourront plus se connecter.",
        "admin.users.bulkDisabled": "$1 utilisateur(s) désactivé(s)",
        "admin.users.bulkDisable": "Désactiver la sélection",
        "admin.users.colUser": "Utilisateur",
        "admin.users.anonymous": "Anonyme",
        "admin.users.colRoles": "Rôles",
        "admin.users.noRoles": "Aucun rôle",
        "admin.users.colStatus": "Statut",
        "admin.users.active": "Actif",
        "admin.users.statusDisabled": "Désactivé",
        "admin.users.colEmail": "Email",
        "admin.users.verified": "Vérifié",
        "admin.users.unverified": "Non vérifié",
        "admin.users.colJoined": "Inscrit",
        "admin.users.viewProfile": "Voir le profil",
        "admin.users.disableUser": "Désactiver l'utilisateur",
        "admin.users.enableUser": "Activer l'utilisateur",
        "admin.users.deleteUser": "Supprimer l'utilisateur",

        // ── Admin Sessions ────────────────────────────────────────────
        "admin.sessions.title": "Sessions",
        "admin.sessions.subtitle": "Sessions utilisateur actives.",
        "admin.sessions.revokeTitle": "Révoquer la session",
        "admin.sessions.revokeConfirm":
          "L'utilisateur sera déconnecté de cette session.",
        "admin.sessions.revoked": "Session révoquée",
        "admin.sessions.colUser": "Utilisateur",
        "admin.sessions.colIp": "IP",
        "admin.sessions.colDevice": "Appareil",
        "admin.sessions.colStarted": "Démarrée",
        "admin.sessions.colStatus": "Statut",
        "admin.sessions.revokedBadge": "Révoquée",
        "admin.sessions.active": "Active",
        "admin.sessions.revoke": "Révoquer",

        // ── Admin Keys ────────────────────────────────────────────────
        "admin.keys.title": "Clés API",
        "admin.keys.subtitle": "Jetons d'accès programmatiques.",
        "admin.keys.revokeTitle": "Révoquer la clé API",
        "admin.keys.revokeConfirm":
          "Révoquer « $1 » ? Les apps utilisant cette clé perdront l'accès.",
        "admin.keys.revoked": "Clé API révoquée",
        "admin.keys.colName": "Nom",
        "admin.keys.colPrefix": "Préfixe",
        "admin.keys.colOwner": "Propriétaire",
        "admin.keys.colScopes": "Scopes",
        "admin.keys.colCreated": "Créée",
        "admin.keys.revoke": "Révoquer",

        // ── Admin Jobs ────────────────────────────────────────────────
        "admin.jobs.title": "Jobs",
        "admin.jobs.loadFailed": "Échec du chargement des jobs",
        "admin.jobs.triggered": "Déclenché : $1",
        "admin.jobs.triggerFailed": "Échec du déclenchement : $1",
        "admin.jobs.countOne": "1 job enregistré",
        "admin.jobs.countMany": "$1 jobs enregistrés",
        "admin.jobs.refresh": "Rafraîchir",
        "admin.jobs.colName": "Nom",
        "admin.jobs.colType": "Type",
        "admin.jobs.colSchedule": "Planning",
        "admin.jobs.colPriority": "Priorité",
        "admin.jobs.colLastRun": "Dernier run",
        "admin.jobs.colOk": "OK",
        "admin.jobs.colErrors": "Erreurs",
        "admin.jobs.never": "jamais",
        "admin.jobs.trigger": "Déclencher",
        "admin.jobs.none": "Aucun job enregistré.",

        // ── Admin Audits ──────────────────────────────────────────────
        "admin.audits.title": "Journal d'audit",
        "admin.audits.subtitle":
          "Historique en lecture seule des actions API et des changements.",
        "admin.audits.colWhen": "Quand",
        "admin.audits.colAction": "Action",
        "admin.audits.colResource": "Ressource",
        "admin.audits.colActor": "Acteur",
        "admin.audits.colStatus": "Statut",
        "admin.audits.ok": "OK",
        "admin.audits.failed": "Échec",

        // ── Admin Notifications ───────────────────────────────────────
        "admin.notifications.title": "Notifications",
        "admin.notifications.subtitle":
          "Journal de livraison email, SMS et autres canaux.",
        "admin.notifications.colWhen": "Quand",
        "admin.notifications.colChannel": "Canal",
        "admin.notifications.colRecipient": "Destinataire",
        "admin.notifications.colSubject": "Sujet",
        "admin.notifications.colStatus": "Statut",

        // ── Admin Files ───────────────────────────────────────────────
        "admin.files.title": "Fichiers",
        "admin.files.subtitle": "Fichiers stockés dans les buckets configurés.",
        "admin.files.upload": "Téléverser",
        "admin.files.uploading": "Téléversement…",
        "admin.files.uploaded": "Téléversé : $1",
        "admin.files.uploadFailed": "Échec du téléversement : $1",
        "admin.files.deleteTitle": "Supprimer le fichier",
        "admin.files.deleteConfirm": "Supprimer définitivement « $1 » ?",
        "admin.files.deleted": "Fichier supprimé",
        "admin.files.colName": "Nom",
        "admin.files.colSize": "Taille",
        "admin.files.colType": "Type",
        "admin.files.colBucket": "Bucket",
        "admin.files.colUploaded": "Téléversé",
        "admin.files.unknown": "inconnu",
        "admin.files.download": "Télécharger",
        "admin.files.delete": "Supprimer",

        // ── Admin Parameters ──────────────────────────────────────────
        "admin.parameters.title": "Paramètres",
        "admin.parameters.subtitle": "Valeurs de configuration au runtime.",
        "admin.parameters.deleteTitle": "Supprimer le paramètre",
        "admin.parameters.deleteConfirm":
          "Supprimer « $1 » ? Les apps lisant cette clé reviendront aux valeurs par défaut.",
        "admin.parameters.deleted": "Paramètre supprimé",
        "admin.parameters.colName": "Nom",
        "admin.parameters.colValue": "Valeur",
        "admin.parameters.colType": "Type",
        "admin.parameters.colUpdated": "Modifié",
        "admin.parameters.delete": "Supprimer",

        // ── Admin Payments ────────────────────────────────────────────
        "admin.payments.title": "Paiements",
        "admin.payments.subtitle":
          "Intentions de paiement, transactions et abonnements.",
        "admin.payments.colWhen": "Quand",
        "admin.payments.colAmount": "Montant",
        "admin.payments.colCustomer": "Client",
        "admin.payments.colProvider": "Fournisseur",
        "admin.payments.colStatus": "Statut",
      },
    }),
  });
}
