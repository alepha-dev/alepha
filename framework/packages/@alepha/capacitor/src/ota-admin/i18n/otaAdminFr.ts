/**
 * French strings of the OTA admin, `ota.admin.*`, the values of
 * {@link otaAdminEn} translated. Spread it into the app's French
 * dictionary, before the app's own keys so the app wins:
 *
 * ```ts
 * fr = $dictionary({ lazy: async () => ({ default: { ...otaAdminFr, ...mine } }) });
 * ```
 */
export const otaAdminFr: Record<string, string> = {
  "ota.admin.apps.colAppId": "Identifiant de bundle",
  "ota.admin.apps.colChannel": "Canal par défaut",
  "ota.admin.apps.colKey": "Clé de l'éditeur",
  "ota.admin.apps.colName": "Nom",
  "ota.admin.apps.create": "Enregistrer une application",
  "ota.admin.apps.createHint":
    "Collez la clé publique de l'éditeur (-----BEGIN RSA PUBLIC KEY-----). Sa moitié privée reste chez qui publie.",
  "ota.admin.apps.createSubmit": "Enregistrer",
  "ota.admin.apps.createTitle": "Enregistrer une application",
  "ota.admin.apps.empty":
    "Aucune application ne reçoit encore de mise à jour à chaud.",
  "ota.admin.apps.publicKey": "Clé publique",
  "ota.admin.bundles.archiveDigest": "SHA-256 de l'archive",
  "ota.admin.bundles.builds": "Builds natifs",
  "ota.admin.bundles.bundle": "Bundle chiffré",
  "ota.admin.bundles.channel": "Publié sur",
  "ota.admin.bundles.ciphertextDigest": "SHA-256 du chiffré",
  "ota.admin.bundles.created": "Publié",
  "ota.admin.bundles.kill": "Arrêt d'urgence",
  "ota.admin.bundles.killConfirm":
    "$1 de $2 ne sera plus jamais servi, épinglages compris. Les appareils qui le détiennent l'abandonnent, et ceux qui l'exécutent reviennent au repli (ou à leur couche web d'origine) à leur prochaine vérification. Un appareil qui reste hors ligne continue de l'exécuter. L'artefact est conservé.",
  "ota.admin.bundles.killTitle": "Arrêter ce bundle ?",
  "ota.admin.bundles.manifest": "Manifeste",
  "ota.admin.bundles.promote": "Servir depuis un canal",
  "ota.admin.bundles.promoteHint":
    "Le déploiement commence petit (10 pour cent par défaut) : une part stable des appareils du canal le reçoit à leur prochaine vérification.",
  "ota.admin.bundles.promoteTitle": "Servir $1",
  "ota.admin.bundles.publish": "Publier",
  "ota.admin.bundles.size": "Taille",
  "ota.admin.bundles.status": "Statut",
  "ota.admin.bundles.upload": "Envoyer une version",
  "ota.admin.bundles.uploadHint":
    "Les deux fichiers qu'écrit alepha capacitor release --dry-run : le manifeste (.json) et le bundle chiffré (.zip). Un ZIP brut est refusé.",
  "ota.admin.bundles.version": "Version",
  "ota.admin.cancel": "Annuler",
  "ota.admin.channels.close": "Fermer aux appareils",
  "ota.admin.channels.create": "Nouveau canal",
  "ota.admin.channels.createHint":
    "Un canal privé s'atteint par une affectation d'appareil. Un canal ouvert, par tout appareil qui le demande.",
  "ota.admin.channels.default": "Par défaut",
  "ota.admin.channels.kill": "Arrêt d'urgence",
  "ota.admin.channels.killConfirm":
    "Tout bundle que le canal $1 de $2 sert est arrêté. Chaque appareil revient au repli de sa cohorte, ou à sa couche web d'origine, à sa prochaine vérification. Un appareil qui reste hors ligne garde ce qu'il exécute.",
  "ota.admin.channels.killTitle": "Arrêter ce canal ?",
  "ota.admin.channels.name": "Nom",
  "ota.admin.channels.noCohort": "Rien n'a encore été publié sur ce canal.",
  "ota.admin.channels.open": "Ouvrir aux appareils",
  "ota.admin.channels.public": "Choisi par l'appareil",
  "ota.admin.channels.selfAssign": "Les appareils peuvent le choisir eux-mêmes",
  "ota.admin.cohort.active": "Actif",
  "ota.admin.cohort.bundle": "Bundle",
  "ota.admin.cohort.fallback": "Choisir le repli",
  "ota.admin.cohort.fallbackColumn": "Repli",
  "ota.admin.cohort.fallbackHint":
    "Ce que reçoivent les appareils hors déploiement, et ce qui remplace un bundle actif arrêté. Aucun signifie la couche web d'origine.",
  "ota.admin.cohort.fingerprint": "Empreinte native",
  "ota.admin.cohort.platform": "Plateforme",
  "ota.admin.cohort.rollback": "Revenir en arrière",
  "ota.admin.cohort.rollbackHint":
    "Servir un bundle antérieur à toute la cohorte, même une version plus ancienne. Les appareils changent à leur prochaine vérification, puis à leur prochain passage en arrière-plan ou redémarrage.",
  "ota.admin.cohort.rollout": "Changer le déploiement",
  "ota.admin.cohort.rolloutHint":
    "La part de cette cohorte qui reçoit le bundle actif. Les autres reçoivent le repli. 0, personne ; 100, tout le monde.",
  "ota.admin.cohort.share": "Déploiement",
  "ota.admin.create": "Créer",
  "ota.admin.devices.build": "Build natif",
  "ota.admin.devices.channel": "Canal",
  "ota.admin.devices.device": "Appareil",
  "ota.admin.devices.failed": "Annulé depuis",
  "ota.admin.devices.hint":
    "Vus ces 7 derniers jours. Télémétrie envoyée par les appareils, pas une présence en direct.",
  "ota.admin.devices.running": "Exécute",
  "ota.admin.devices.seen": "Vu pour la dernière fois",
  "ota.admin.kill": "Arrêter",
  "ota.admin.nav": "Mises à jour à chaud",
  "ota.admin.navGroup": "Mises à jour à chaud",
  "ota.admin.overrides.create": "Affecter un appareil",
  "ota.admin.overrides.hint":
    "Un canal, un bundle épinglé, ou les deux. L'épinglage l'emporte tant que son bundle peut être servi.",
  "ota.admin.overrides.note": "Note",
  "ota.admin.overrides.pinned": "Bundle épinglé",
  "ota.admin.overrides.remove": "Retirer",
  "ota.admin.overrides.removeConfirm":
    "L'appareil $1 revient à son propre canal à sa prochaine vérification.",
  "ota.admin.overrides.removeTitle": "Retirer cette affectation ?",
  "ota.admin.save": "Enregistrer",
  "ota.admin.settings.delete": "Supprimer l'application",
  "ota.admin.settings.deleteConfirm":
    "$1 ne reçoit plus de mises à jour à chaud : ses canaux, bundles et appareils disparaissent, et les applications installées gardent la couche web qu'elles exécutent.",
  "ota.admin.settings.deleteTitle": "Supprimer cette application ?",
  "ota.admin.settings.keyHint":
    "La changer est une rotation de clé : les bundles scellés avec l'ancienne clé sont refusés, et les binaires qui portent l'ancienne clé ne peuvent pas exécuter les nouveaux bundles.",
  "ota.admin.settings.keys": "Clés d'API autorisées à publier (identifiants)",
  "ota.admin.status.deleted": "Supprimé",
  "ota.admin.status.failed": "Échec",
  "ota.admin.status.killed": "Arrêté",
  "ota.admin.status.ready": "Prêt",
  "ota.admin.status.uploading": "Envoi en cours",
  "ota.admin.tab.bundles": "Bundles",
  "ota.admin.tab.channels": "Canaux",
  "ota.admin.tab.devices": "Appareils",
  "ota.admin.tab.overrides": "Affectations d'appareils",
  "ota.admin.tab.settings": "Réglages",
};
