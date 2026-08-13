/**
 * French strings for every component in this package.
 *
 * ### Why this is a plain object and not a `$dictionary`
 *
 * `@alepha/ui` is a component library, not a module: it has no `$module`, no
 * entry point and no DI of its own — a consumer imports the components it wants
 * and nothing else. Shipping a `$dictionary` here would mean giving the package a
 * container to register into, which is a much larger change than the problem
 * warrants.
 *
 * So this is a record the application spreads into *its* catalogue:
 *
 * ```ts
 * import { uiFr } from "@alepha/ui/lib/i18n-fr";
 *
 * export class AppI18n {
 *   fr = $dictionary({
 *     lazy: async () => ({ default: { ...uiFr, ...mesClés } }),
 *   });
 * }
 * ```
 *
 * Spread first so the application always wins on a key it also defines.
 *
 * ### Why it exists at all
 *
 * The components already call `tr("…", { default: "English" })`, which reads as
 * "translatable" but behaves as "English unless somebody defines the key". Nobody
 * did, so a French application got a French interface with English dialogs — a
 * confirmation that said "Cancel / Confirm", a table whose menu announced "Open
 * row actions", and an entire back office in English. `locale: "fr-FR"` changed
 * nothing, because the browser language was never the problem: the catalogue was.
 *
 * ### Coverage
 *
 * Every `tr()` key in the package, with no extras — the first version covered
 * only the three areas one application happened to walk through, which is a
 * sample and not a catalogue. Keys interpolate with `$1`, `$2` … positionally,
 * matching the `args` each call site passes.
 *
 * A second language means a sibling file; there is deliberately no `uiEn`, since
 * the components already default to English.
 */
export const uiFr: Record<string, string> = {
  // The imperative confirm / alert / prompt.
  "useDialog.cancel": "Annuler",
  "useDialog.confirm": "Confirmer",
  "useDialog.ok": "OK",

  // The data table: toolbar, selection, empty state.
  "alephaTable.clearSelection": "Annuler la sélection",
  "alephaTable.columns": "Colonnes",
  "alephaTable.empty": "Aucun résultat.",
  "alephaTable.openRowActions": "Ouvrir les actions de la ligne",
  "alephaTable.refresh": "Actualiser",
  "alephaTable.resetFilters": "Réinitialiser les filtres",
  "alephaTable.selectAll": "Sélectionner toutes les lignes",
  "alephaTable.selectRow": "Sélectionner la ligne",
  "alephaTable.selected": "$1 sélectionné(s)",
  "alephaTable.toggleColumns": "Afficher ou masquer des colonnes",

  // Schema-generated forms.
  "autoForm.cancel": "Annuler",
  "autoForm.error": "Erreur",
  "autoForm.errors": "Erreurs du formulaire",
  "autoForm.formLabel": "Formulaire",
  "autoForm.reset": "Réinitialiser",
  "autoForm.save": "Enregistrer",

  // Array control — repeatable items.
  "controlArray.add": "Ajouter",
  "controlArray.cancel": "Annuler",
  "controlArray.collapse": "Replier",
  "controlArray.delete": "Supprimer",
  "controlArray.deleteConfirm": "Voulez-vous vraiment supprimer cet élément ?",
  "controlArray.deleteTitle": "Supprimer l'élément",
  "controlArray.expand": "Déplier",
  "controlArray.moveDown": "Descendre",
  "controlArray.moveUp": "Monter",
  "controlArray.remove": "Retirer",

  // Object control — nested groups.
  "controlObject.clear": "Vider",
  "controlObject.collapse": "Replier",
  "controlObject.expand": "Déplier",
  "controlObject.initialize": "Initialiser",

  // Select, combobox and boolean controls.
  "controlSelect.create": "Créer « $1 »",
  "controlSelect.loading": "Chargement…",
  "controlSelect.no": "Non",
  "controlSelect.noResults": "Aucun résultat.",
  "controlSelect.none": "Aucun",
  "controlSelect.select": "Sélectionner…",
  "controlSelect.yes": "Oui",

  // File upload control.
  "controlUpload.chooseFile": "Choisir un fichier",
  "controlUpload.chooseFiles": "Choisir des fichiers",
  "controlUpload.dragDrop":
    "Déposez un fichier ici, ou cliquez pour en choisir un",
  "controlUpload.failed": "Envoi échoué : $1",
  "controlUpload.max": "$1 maximum",
  "controlUpload.remove": "Retirer",
  "controlUpload.savedFile": "Fichier enregistré",
  "controlUpload.singleOnly": "Un seul fichier est accepté",
  "controlUpload.tooBig": "$1 dépasse $2",
  "controlUpload.uploadedMany": "$1 fichiers envoyés",
  "controlUpload.uploadedOne": "Fichier envoyé",
  "controlUpload.uploading": "Envoi…",

  // Sign-in, registration, password reset, email verification.
  "auth.login.cancel": "Annuler",
  "auth.login.continueWith": "Continuer avec $1",
  "auth.login.email": "Adresse e-mail",
  "auth.login.error": "Une erreur est survenue. Merci de réessayer.",
  "auth.login.forgot": "Mot de passe oublié ?",
  "auth.login.identifier": "Identifiant, e-mail ou téléphone",
  "auth.login.invalid": "Identifiant ou mot de passe incorrect",
  "auth.login.noAccount": "Pas encore de compte ?",
  "auth.login.or": "OU",
  "auth.login.password": "Mot de passe",
  "auth.login.phone": "Numéro de téléphone",
  "auth.login.signUp": "Créer un compte",
  "auth.login.submit": "Se connecter",
  "auth.login.username": "Identifiant",
  "auth.register.backToSignIn": "Retour à la connexion",
  "auth.register.cancel": "Annuler",
  "auth.register.continueWith": "Continuer avec $1",
  "auth.register.disabled":
    "Les inscriptions ne sont pas ouvertes. Contactez votre administrateur.",
  "auth.register.email": "Adresse e-mail",
  "auth.register.email.verify":
    "Nous vous enverrons un code pour confirmer votre adresse.",
  "auth.register.emailCode": "Code reçu par e-mail",
  "auth.register.firstName": "Prénom",
  "auth.register.haveAccount": "Vous avez déjà un compte ?",
  "auth.register.lastName": "Nom",
  "auth.register.or": "OU",
  "auth.register.password": "Mot de passe",
  "auth.register.password.rule.lowercase": "Une minuscule",
  "auth.register.password.rule.minLength": "$1 caractères au minimum",
  "auth.register.password.rule.number": "Un chiffre",
  "auth.register.password.rule.special": "Un caractère spécial",
  "auth.register.password.rule.uppercase": "Une majuscule",
  "auth.register.phone": "Numéro de téléphone",
  "auth.register.phone.verify":
    "Nous vous enverrons un code pour confirmer votre numéro.",
  "auth.register.phoneCode": "Code reçu par SMS",
  "auth.register.signIn": "Se connecter",
  "auth.register.submit": "Créer mon compte",
  "auth.register.username": "Identifiant",
  "auth.register.verifyBack": "Retour à l'inscription",
  "auth.register.verifyFailed": "Vérification échouée",
  "auth.register.verifyHint":
    "Saisissez le ou les codes qui vous ont été envoyés.",
  "auth.register.verifySubmit": "Terminer l'inscription",
  "auth.register.verifyTitle": "Vérifiez votre compte",
  "auth.reset.backToSignIn": "Retour à la connexion",
  "auth.reset.cancel": "Annuler",
  "auth.reset.codeLabel": "Saisissez le code à 6 chiffres",
  "auth.reset.codeSent": "Nous vous avons envoyé un code par e-mail.",
  "auth.reset.confirmPassword": "Confirmez le mot de passe",
  "auth.reset.continue": "Continuer",
  "auth.reset.disabled":
    "La réinitialisation n'est pas disponible. Contactez votre administrateur.",
  "auth.reset.email": "Adresse e-mail",
  "auth.reset.emailHint":
    "Saisissez votre adresse e-mail pour réinitialiser votre mot de passe",
  "auth.reset.invalidState": "Demande de réinitialisation invalide",
  "auth.reset.newPassword": "Nouveau mot de passe",
  "auth.reset.newPasswordHint": "Choisissez votre nouveau mot de passe",
  "auth.reset.passwordsMismatch": "Les mots de passe ne correspondent pas",
  "auth.reset.resend": "Renvoyer le code",
  "auth.reset.resendFailed": "Le code n'a pas pu être renvoyé",
  "auth.reset.sendCode": "Envoyer le code",
  "auth.reset.setPassword": "Définir le nouveau mot de passe",
  "auth.reset.success": "Votre mot de passe a bien été réinitialisé.",
  "auth.reset.title": "Réinitialiser le mot de passe",
  "auth.verify.backToSignIn": "Retour à la connexion",
  "auth.verify.errorTitle": "La vérification a échoué",
  "auth.verify.failed":
    "Votre adresse n'a pas pu être vérifiée. Le lien a peut-être expiré, ou il est invalide.",
  "auth.verify.invalidLink":
    "Lien de vérification invalide : l'adresse et le jeton sont requis.",
  "auth.verify.signIn": "Se connecter à votre compte",
  "auth.verify.success": "Votre adresse e-mail a bien été vérifiée.",
  "auth.verify.successTitle": "Adresse vérifiée",
  "auth.verify.verifying": "Vérification en cours…",
  "auth.verify.verifyingHint":
    "Merci de patienter pendant la vérification de votre adresse.",

  // The `@alepha/ui/admin` back office: users, sessions, API keys, files, jobs,
  // audits, notifications, payments and parameters.
  "admin.audits.actionAll": "Toutes les actions",
  "admin.audits.bulkDelete": "Supprimer la sélection",
  "admin.audits.bulkDeleteConfirm":
    "Supprimer $1 entrée(s) d'audit ? Ces journaux sont généralement conservés pour des raisons de conformité — l'opération est irréversible.",
  "admin.audits.bulkDeleteTitle": "Supprimer des entrées d'audit",
  "admin.audits.bulkDeleted": "$1 entrée(s) d'audit supprimée(s)",
  "admin.audits.colAction": "Action",
  "admin.audits.colActor": "Auteur",
  "admin.audits.colResource": "Ressource",
  "admin.audits.colStatus": "Statut",
  "admin.audits.colWhen": "Date",
  "admin.audits.failed": "Échec",
  "admin.audits.ok": "OK",
  "admin.audits.statusAll": "Tous les statuts",
  "admin.files.allBuckets": "Tous les buckets",
  "admin.files.bucketPlaceholder": "Bucket",
  "admin.files.bulkDelete": "Supprimer la sélection",
  "admin.files.bulkDeleteConfirm":
    "Supprimer définitivement $1 fichier(s) ? L'opération est irréversible.",
  "admin.files.bulkDeleteTitle": "Supprimer des fichiers",
  "admin.files.bulkDeleted": "$1 fichier(s) supprimé(s)",
  "admin.files.colBucket": "Bucket",
  "admin.files.colName": "Nom",
  "admin.files.colSize": "Taille",
  "admin.files.colType": "Type",
  "admin.files.colUploaded": "Envoyé le",
  "admin.files.colUser": "Envoyé par",
  "admin.files.delete": "Supprimer",
  "admin.files.deleteConfirm": "Supprimer définitivement « $1 » ?",
  "admin.files.deleteTitle": "Supprimer le fichier",
  "admin.files.deleted": "Fichier supprimé",
  "admin.files.download": "Télécharger",
  "admin.files.searchPlaceholder": "Rechercher par nom…",
  "admin.files.unknown": "inconnu",
  "admin.files.upload": "Envoyer",
  "admin.files.uploaded": "$1 envoyé",
  "admin.files.uploading": "Envoi…",
  "admin.jobs.cancel": "Annuler",
  "admin.jobs.cancelConfirm":
    "Annuler cette exécution en attente ? Elle ne sera pas lancée.",
  "admin.jobs.cancelTitle": "Annuler l'exécution",
  "admin.jobs.cancelled": "Exécution annulée",
  "admin.jobs.colAttempt": "Tentative",
  "admin.jobs.colDuration": "Durée",
  "admin.jobs.colError": "Erreur",
  "admin.jobs.colErrors": "Erreurs",
  "admin.jobs.colLastRun": "Dernière exécution",
  "admin.jobs.colName": "Nom",
  "admin.jobs.colOk": "OK",
  "admin.jobs.colPriority": "Priorité",
  "admin.jobs.colSchedule": "Planification",
  "admin.jobs.colStarted": "Démarrée le",
  "admin.jobs.colStatus": "Statut",
  "admin.jobs.colTriggeredBy": "Déclenchée par",
  "admin.jobs.colType": "Type",
  "admin.jobs.execsDescription": "Exécutions récentes de cette tâche.",
  "admin.jobs.noExecs": "Aucune exécution pour l'instant.",
  "admin.jobs.none": "Aucune tâche enregistrée.",
  "admin.jobs.notStarted": "—",
  "admin.jobs.priorityAll": "Toutes les priorités",
  "admin.jobs.retried": "Exécution remise en file",
  "admin.jobs.retry": "Relancer",
  "admin.jobs.retryConfirm":
    "Remettre cette exécution en file pour une nouvelle tentative ?",
  "admin.jobs.retryTitle": "Relancer l'exécution",
  "admin.jobs.searchPlaceholder": "Rechercher…",
  "admin.jobs.statusAll": "Tous les statuts",
  "admin.jobs.trigger": "Déclencher maintenant",
  "admin.jobs.triggered": "$1 déclenchée",
  "admin.jobs.typeAll": "Tous les types",
  "admin.jobs.unknown": "inconnu",
  "admin.jobs.viewExecutions": "Voir les exécutions",
  "admin.keys.bulkRevoke": "Révoquer la sélection",
  "admin.keys.bulkRevokeConfirm":
    "Révoquer $1 clé(s) d'API ? Les applications qui les utilisent perdront l'accès.",
  "admin.keys.bulkRevokeTitle": "Révoquer des clés d'API",
  "admin.keys.bulkRevoked": "$1 clé(s) d'API révoquée(s)",
  "admin.keys.colCreated": "Créée le",
  "admin.keys.colName": "Nom",
  "admin.keys.colOwner": "Propriétaire",
  "admin.keys.colPrefix": "Préfixe",
  "admin.keys.colScopes": "Rôles",
  "admin.keys.copy": "Copier",
  "admin.keys.copyFailed": "Impossible de copier",
  "admin.keys.create": "Ajouter une clé d'API",
  "admin.keys.createConfirm": "Créer",
  "admin.keys.createDescription":
    "La clé est créée pour votre compte et porte vos rôles actuels.",
  "admin.keys.createNameLabel": "Nom",
  "admin.keys.createNamePlaceholder": "ex. pipeline CI",
  "admin.keys.createNameRequired": "Le nom est requis",
  "admin.keys.createTitle": "Ajouter une clé d'API",
  "admin.keys.noneSelected": "Aucune clé active dans la sélection",
  "admin.keys.revoke": "Révoquer",
  "admin.keys.revokeConfirm":
    "Révoquer « $1 » ? Les applications qui utilisent cette clé perdront l'accès.",
  "admin.keys.revokeTitle": "Révoquer la clé d'API",
  "admin.keys.revoked": "Clé d'API révoquée",
  "admin.keys.tokenDescription":
    "Copiez ce jeton maintenant — il n'est affiché qu'une seule fois et ne peut pas être récupéré.",
  "admin.keys.tokenDone": "Terminé",
  "admin.keys.tokenTitle": "Clé d'API créée",
  "admin.notifications.bulkDelete": "Supprimer la sélection",
  "admin.notifications.bulkDeleteConfirm":
    "Supprimer $1 notification(s) ? L'opération est irréversible.",
  "admin.notifications.bulkDeleteTitle": "Supprimer des notifications",
  "admin.notifications.bulkDeleted": "$1 notification(s) supprimée(s)",
  "admin.notifications.colRecipient": "Destinataire",
  "admin.notifications.colStatus": "Statut",
  "admin.notifications.colTemplate": "Modèle",
  "admin.notifications.colType": "Type",
  "admin.notifications.colWhen": "Date",
  "admin.parameters.activationDateHint":
    "Laissez vide pour appliquer immédiatement.",
  "admin.parameters.cancel": "Annuler",
  "admin.parameters.copy": "Copier",
  "admin.parameters.copyFailed": "La copie a échoué",
  "admin.parameters.diffCancel": "Annuler",
  "admin.parameters.diffDialogDescription":
    "Différences avec la version précédente.",
  "admin.parameters.diffWithPrevious": "Comparer à la précédente",
  "admin.parameters.emptySelection":
    "Choisissez un paramètre à gauche pour le modifier.",
  "admin.parameters.emptyTitle": "Aucun paramètre sélectionné",
  "admin.parameters.export": "Exporter",
  "admin.parameters.factoryReset": "Paramètre réinitialisé",
  "admin.parameters.factoryResetConfirm":
    "Revenir aux valeurs compilées par défaut ? La modification ci-dessous sera enregistrée comme une nouvelle version.",
  "admin.parameters.factoryResetTitle": "Réinitialisation d'usine",
  "admin.parameters.fieldActivationDate": "Activer le",
  "admin.parameters.fieldCreatedAt": "Créée le",
  "admin.parameters.fieldCreatedBy": "Créée par",
  "admin.parameters.fieldNote": "Note",
  "admin.parameters.fieldTags": "Étiquettes",
  "admin.parameters.fieldVersion": "Version",
  "admin.parameters.historyEmpty": "Aucune version enregistrée",
  "admin.parameters.historyHint":
    "Sélectionnez un paramètre pour voir ses versions.",
  "admin.parameters.historyTitle": "Historique",
  "admin.parameters.import": "Importer",
  "admin.parameters.importConfirm": "Importer $1 paramètre(s) ?",
  "admin.parameters.importInvalidJson": "Fichier JSON invalide",
  "admin.parameters.importNoItems": "Aucun paramètre trouvé dans le fichier",
  "admin.parameters.importNoneMatch":
    "Aucun paramètre enregistré ne correspond aux noms importés",
  "admin.parameters.importTitle": "Importer des paramètres",
  "admin.parameters.imported": "$1 paramètre(s) importé(s)",
  "admin.parameters.jsonDialogDescription":
    "Contenu JSON brut de cette version du paramètre.",
  "admin.parameters.rollback": "Revenir à cette version",
  "admin.parameters.rollbackConfirm":
    "Revenir à la version $1 ? Une nouvelle version reprenant ce contenu sera créée.",
  "admin.parameters.rollbackTitle": "Revenir à une version antérieure",
  "admin.parameters.rolledBack": "Paramètre restauré",
  "admin.parameters.save": "Enregistrer une nouvelle version",
  "admin.parameters.saveDialogDescription":
    "Vous pouvez étiqueter et planifier cette version avant de l'enregistrer.",
  "admin.parameters.saveDialogTitle": "Enregistrer une nouvelle version",
  "admin.parameters.saved": "Paramètre enregistré",
  "admin.parameters.tagsPlaceholder": "Ajouter des étiquettes…",
  "admin.parameters.treeEmpty": "Aucun paramètre enregistré.",
  "admin.parameters.treeTitle": "Paramètres",
  "admin.parameters.versionActions": "Actions sur la version",
  "admin.parameters.view": "Consulter",
  "admin.payments.colAmount": "Montant",
  "admin.payments.colCustomer": "Client",
  "admin.payments.colProvider": "Prestataire",
  "admin.payments.colStatus": "Statut",
  "admin.payments.colWhen": "Date",
  "admin.sessions.bulkRevoke": "Révoquer la sélection",
  "admin.sessions.bulkRevokeConfirm":
    "Révoquer $1 session(s) ? Les utilisateurs concernés seront déconnectés.",
  "admin.sessions.bulkRevokeTitle": "Révoquer des sessions",
  "admin.sessions.bulkRevoked": "$1 session(s) révoquée(s)",
  "admin.sessions.colDevice": "Appareil",
  "admin.sessions.colExpires": "Expire le",
  "admin.sessions.colIp": "IP",
  "admin.sessions.colStarted": "Ouverte le",
  "admin.sessions.colUser": "Utilisateur",
  "admin.sessions.revoke": "Révoquer",
  "admin.sessions.revokeConfirm":
    "L'utilisateur sera déconnecté de cette session.",
  "admin.sessions.revokeTitle": "Révoquer la session",
  "admin.sessions.revoked": "Session révoquée",
  "admin.userDetail.active": "Actif",
  "admin.userDetail.back": "Retour aux utilisateurs",
  "admin.userDetail.bulkRevokeConfirm": "Révoquer $1 sessions ?",
  "admin.userDetail.bulkRevokeTitle": "Révoquer des sessions",
  "admin.userDetail.cancel": "Annuler",
  "admin.userDetail.changePassword": "Changer le mot de passe",
  "admin.userDetail.colAction": "Action",
  "admin.userDetail.colAuditStatus": "Statut",
  "admin.userDetail.colDevice": "Appareil",
  "admin.userDetail.colIp": "IP",
  "admin.userDetail.colResource": "Ressource",
  "admin.userDetail.colStarted": "Ouverte le",
  "admin.userDetail.colWhen": "Date",
  "admin.userDetail.copyId": "Copier l'identifiant",
  "admin.userDetail.created": "Créé le",
  "admin.userDetail.credentials": "Identifiants",
  "admin.userDetail.credentialsHasPassword":
    "Un mot de passe est défini. Vous ne pouvez pas le retirer, mais vous pouvez en définir un nouveau.",
  "admin.userDetail.credentialsNoPassword":
    "Aucun mot de passe n'est défini. Définissez-en un pour permettre la connexion par mot de passe.",
  "admin.userDetail.credentialsSub":
    "Connexion par mot de passe pour ce compte.",
  "admin.userDetail.delete": "Supprimer l'utilisateur",
  "admin.userDetail.deleteConfirm":
    "Supprimer définitivement $1 ? L'opération est irréversible.",
  "admin.userDetail.deleteCta": "Supprimer",
  "admin.userDetail.deleteTitle": "Supprimer l'utilisateur",
  "admin.userDetail.deleted": "Utilisateur supprimé",
  "admin.userDetail.disable": "Désactiver",
  "admin.userDetail.disableConfirm":
    "Désactiver $1 ? Cette personne ne pourra plus se connecter.",
  "admin.userDetail.disableTitle": "Désactiver l'utilisateur",
  "admin.userDetail.disabled": "Utilisateur désactivé",
  "admin.userDetail.disabledBadge": "Désactivé",
  "admin.userDetail.email": "Adresse e-mail",
  "admin.userDetail.emailCannotBeCleared":
    "L'adresse e-mail ne peut pas être supprimée une fois renseignée",
  "admin.userDetail.emailRequired": "L'adresse e-mail est requise",
  "admin.userDetail.emailVerified": "Adresse vérifiée",
  "admin.userDetail.enable": "Réactiver",
  "admin.userDetail.enableConfirm": "Réactiver $1 ?",
  "admin.userDetail.enableTitle": "Réactiver l'utilisateur",
  "admin.userDetail.enabled": "Utilisateur réactivé",
  "admin.userDetail.failed": "Échec",
  "admin.userDetail.fieldStatus": "Statut",
  "admin.userDetail.firstName": "Prénom",
  "admin.userDetail.id": "Identifiant",
  "admin.userDetail.identities": "Comptes liés",
  "admin.userDetail.identitiesSub": "Fournisseurs OAuth associés.",
  "admin.userDetail.identityRemoved": "Liaison supprimée",
  "admin.userDetail.lastLogin": "Dernière connexion",
  "admin.userDetail.lastName": "Nom",
  "admin.userDetail.loadError": "L'utilisateur n'a pas pu être chargé",
  "admin.userDetail.name": "Nom",
  "admin.userDetail.never": "Jamais",
  "admin.userDetail.newPassword": "Nouveau mot de passe",
  "admin.userDetail.noIdentities": "Aucun compte lié.",
  "admin.userDetail.notFound": "Utilisateur introuvable.",
  "admin.userDetail.ok": "OK",
  "admin.userDetail.passwordSet": "Mot de passe mis à jour",
  "admin.userDetail.phone": "Téléphone",
  "admin.userDetail.profile": "Profil",
  "admin.userDetail.profileSub": "Identité et coordonnées.",
  "admin.userDetail.remove": "Retirer",
  "admin.userDetail.removeIdentityConfirm":
    "Retirer la liaison $1 ? L'utilisateur ne pourra plus s'en servir pour se connecter.",
  "admin.userDetail.removeIdentityTitle": "Retirer la liaison",
  "admin.userDetail.revoke": "Révoquer",
  "admin.userDetail.revokeConfirm":
    "Révoquer cette session ? L'utilisateur sera déconnecté sur l'appareil correspondant.",
  "admin.userDetail.revokeSelected": "Révoquer la sélection",
  "admin.userDetail.revokeTitle": "Révoquer la session",
  "admin.userDetail.roles": "Rôles",
  "admin.userDetail.save": "Enregistrer les modifications",
  "admin.userDetail.saveError": "Le profil n'a pas pu être enregistré",
  "admin.userDetail.savePassword": "Enregistrer",
  "admin.userDetail.saved": "Profil enregistré",
  "admin.userDetail.setPassword": "Définir un mot de passe",
  "admin.userDetail.setPasswordSub":
    "L'utilisateur pourra se connecter avec ce mot de passe immédiatement. Les sessions en cours ne sont pas révoquées.",
  "admin.userDetail.setPasswordTitle": "Définir un nouveau mot de passe",
  "admin.userDetail.tabAudits": "Journal d'audit",
  "admin.userDetail.tabOverview": "Vue d'ensemble",
  "admin.userDetail.tabSecurity": "Sécurité",
  "admin.userDetail.tabSessions": "Sessions",
  "admin.userDetail.thisUser": "cet utilisateur",
  "admin.userDetail.username": "Identifiant",
  "admin.userDetail.usernameCannotBeCleared":
    "L'identifiant ne peut pas être supprimé une fois renseigné",
  "admin.userDetail.usernameRequired": "L'identifiant est requis",
  "admin.userDetail.verified": "Vérifié",
  "admin.users.active": "Actif",
  "admin.users.bulkDelete": "Supprimer la sélection",
  "admin.users.bulkDeleteConfirm":
    "Supprimer $1 utilisateur(s) ? L'opération est irréversible.",
  "admin.users.bulkDeleteTitle": "Supprimer des utilisateurs",
  "admin.users.bulkDeleted": "$1 utilisateur(s) supprimé(s)",
  "admin.users.bulkDisable": "Désactiver la sélection",
  "admin.users.bulkDisableConfirm":
    "Désactiver $1 utilisateur(s) ? Ils ne pourront plus se connecter.",
  "admin.users.bulkDisableTitle": "Désactiver des utilisateurs",
  "admin.users.bulkDisabled": "$1 utilisateur(s) désactivé(s)",
  "admin.users.cantDisableSelf":
    "Vous ne pouvez pas désactiver votre propre compte",
  "admin.users.colEmail": "Adresse e-mail",
  "admin.users.colFirstName": "Prénom",
  "admin.users.colJoined": "Inscrit le",
  "admin.users.colLastLogin": "Dernière connexion",
  "admin.users.colLastName": "Nom",
  "admin.users.colRoles": "Rôles",
  "admin.users.colStatus": "Statut",
  "admin.users.colUsername": "Identifiant",
  "admin.users.deleteConfirm":
    "Supprimer définitivement $1 ? L'opération est irréversible.",
  "admin.users.deleteTitle": "Supprimer l'utilisateur",
  "admin.users.deleteUser": "Supprimer l'utilisateur",
  "admin.users.deleted": "Utilisateur supprimé",
  "admin.users.disableConfirm":
    "Désactiver $1 ? Cette personne ne pourra plus se connecter.",
  "admin.users.disableTitle": "Désactiver l'utilisateur",
  "admin.users.disableUser": "Désactiver l'utilisateur",
  "admin.users.disabled": "Utilisateur désactivé",
  "admin.users.enableConfirm": "Réactiver $1 ?",
  "admin.users.enableTitle": "Réactiver l'utilisateur",
  "admin.users.enableUser": "Réactiver l'utilisateur",
  "admin.users.enabled": "Utilisateur réactivé",
  "admin.users.noRoles": "Aucun rôle",
  "admin.users.noneSelected": "Aucun utilisateur supprimable dans la sélection",
  "admin.users.rolesLabel": "Rôles",
  "admin.users.search": "Rechercher un utilisateur",
  "admin.users.searchPlaceholder": "Rechercher…",
  "admin.users.statusActive": "Actif",
  "admin.users.statusAll": "Tous les statuts",
  "admin.users.statusDisabled": "Désactivé",
  "admin.users.statusVerified": "Vérifié",
  "admin.users.thisUser": "cet utilisateur",
  "admin.users.verified": "Vérifié",
  "admin.users.viewProfile": "Voir le profil",
};
