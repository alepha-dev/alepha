import { $dictionary } from "alepha/react/i18n";

export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        en: "English",
        fr: "Français",

        "language.en": "English",
        "language.fr": "Français",

        "header.title": "Roadmap",
        "header.campaign.addQuest": "Create New Quest",
        "header.addQuest.name": "Quest Name",
        "header.actions.profile": "Profile",
        "header.actions.login": "Sign In",
        "header.actions.logout": "Logout",
        "header.actions.admin": "Admin Panel",
        "header.actions.profile.level": "Level $1",

        "quest-log.quests": "Quests:",
        "quest-log.search": "Find by name, zone...",
        "quest-log.empty": "No quests available.",

        "home.title": "Welcome, Adventurer",
        "home.subtitle":
          "Your journey begins here. Pick a campaign and start completing quests.",
        "home.no-campaign": "You don't have any campaigns yet.",
        "home.campaigns": "Your recent campaigns",
        "home.create-campaign": "New Campaign",
        "home.lore": "Open your Lore",
        "home.lore-description":
          "Personal markdown notes — searchable, taggable, AI-accessible via MCP.",

        "lore.title": "Lore",
        "lore.search": "Search folios…",
        "lore.tags": "Tags",
        "lore.new": "New folio",
        "lore.new-folio": "New folio",
        "lore.edit-folio": "Edit folio",
        "lore.edit": "Edit",
        "lore.delete": "Delete",
        "lore.save": "Save",
        "lore.back": "Back",
        "lore.empty-list": "No folios yet.",
        "lore.empty-folio": "(empty)",
        "lore.empty-title": "Your Lore is empty",
        "lore.empty-subtitle":
          "Capture knowledge as markdown. Tag it, search it, hand it to your AI.",
        "lore.title-placeholder": "Untitled",
        "lore.content-placeholder": "Start writing markdown…",
        "lore.confirm-delete-title": "Delete this folio?",
        "lore.confirm-delete-message": "This cannot be undone.",
        "lore.updated": "Updated $1",

        "board.filter.search": "Search",
        "board.filter.status": "Status",
        "board.filter.zone": "Zone",
        "board.filter.apply": "Apply",
        "board.filter.reset": "Reset",

        "dashboard.character": "Hero",
        "dashboard.purse": "Purse",
        "dashboard.chapter": "Active chapter",
        "dashboard.chapter.none": "No open chapter",

        "campaign.menu.create-quest": "Create Quest",
        "campaign.menu.dashboard": "Tavern",
        "campaign.menu.board": "Board",
        "campaign.menu.adventurers": "Adventurers",
        "campaign.menu.chronicles": "Chronicles",
        "campaign.menu.whiteboards": "Draw",
        "campaign.menu.settings": "Settings",

        "quest.create.submit": "Add Quest to Campaign",
        "quest.create.update": "Update Quest",
        "quest.create.difficulty": "Difficulty",
        "quest.create.difficulty.helper":
          "Rate how challenging this quest will be",
        "quest.create.priority": "Priority",
        "quest.create.priority.helper":
          "How urgently this quest must be fulfilled",
        "quest.create.description": "Quest Description",
        "quest.create.description.helper":
          "Describe the quest, its objectives, and any relevant details",
        "quest.create.zone": "Zone",
        "quest.create.zone.helper": "Where the quest takes place",
        "quest.create.title": "Name",
        "quest.create.title.helper": "Short and descriptive name",
        "quest.create.objectives": "Objectives",
        "quest.create.objectives.helper": "List of objectives for this quest",
        "quest.create.attachments": "Attachments",
        "quest.create.attachments.helper": "Attach files to this quest",

        "priority.high": "High",
        "priority.medium": "Normal",
        "priority.low": "Low",
        "priority.none": "None",

        "campaign.create.title": "Create a new campaign",
        "campaign.create.description":
          "Raise your banner! Forge quests, recruit adventurers and progress together toward victory.",

        "campaign.create.name": "Campaign Name",
        "campaign.create.name.helper":
          "Set a short name for identifying your campaign.",
        "campaign.create.public": "Public",
        "campaign.create.public.helper":
          "If enabled, your campaign will be visible across the realm, not just to you and your adventurers.",
        "campaign.create.submit": "Create Campaign",

        "quest.view.summary":
          "This quest has $1 priority. Difficulty tier: $2.",
        "quest.view.description": "Description",
        "quest.view.rewards": "Rewards",
        "quest.view.receive": "You will receive:",
        "quest.view.experience": "Experience:",
        "quest.view.created": "created",
        "quest.view.actions.complete": "Complete Quest",
        "quest.view.actions.abandon": "Abandon Quest",
        "quest.view.noObjectives": "No objectives for this quest.",
        "quest.view.objectives": "Objectives",
        "quest.view.attachments": "Attachments",

        "quest.view.actions.accept": "Sign and Accept the Quest",

        "quest.view.history": "History",
        "quest.view.history.assigned": "Courageous Choice",
        "quest.view.history.unassigned": "Fateful Decision",
        "quest.view.history.completed": "At Long Last",
        "quest.view.history.created": "A New Dawn",
        "quest.view.history.objectiveCompleted": "Objective Achieved",
        "quest.view.history.changed": "Notable Change",
        "quest.view.history.objectiveCompletedBy":
          "An objective has been fulfilled.",
        "quest.view.history.actionBy": "Quest has been $1.",
        "quest.view.history.questCompletedBy":
          "The quest has been completed. Victory!",
        "quest.view.history.questCreatedBy": "A new quest has been forged.",

        "campaign.settings.adventurers.title": "Adventurers",
        "campaign.settings.adventurers.empty":
          "No adventurers in this campaign yet.",
        "campaign.settings.adventurers.invite.action": "Invite",
        "campaign.settings.adventurers.invite.title": "Invite Adventurer",
        "campaign.settings.adventurers.invite.description":
          'Enter the email address of the adventurer you want to invite to "$1".',
        "campaign.settings.adventurers.invite.email": "Email Address",
        "campaign.settings.adventurers.invite.cancel": "Cancel",
        "campaign.settings.adventurers.invite.submit": "Send Invitation",

        "campaign.settings.danger.title": "Danger Zone",
        "campaign.settings.actions.delete": "Delete this campaign",
        "campaign.settings.actions.delete.helper":
          "Sometimes retreat is the only option. All quests and progress will be lost forever.",

        "campaign.settings.general.title": "General",
        "campaign.settings.whiteboard": "Whiteboard",
        "campaign.settings.whiteboard.helper":
          "Enable the drawing canvas to sketch plans and map out your quests.",
        "campaign.settings.character.title": "Character",
        "campaign.settings.character.level": "Level $1",
        "campaign.settings.character.nextLevel": "$1 XP to next level",
        "campaign.settings.character.balance": "Balance",
        "campaign.settings.delete.modal.title": "Delete Campaign",
        "campaign.settings.delete.modal.description":
          "This action cannot be undone. This will permanently destroy the campaign and all its quests.",
        "campaign.settings.delete.modal.confirm": "Please type $1 to confirm:",
        "campaign.settings.delete.modal.cancel": "Cancel",
        "campaign.settings.delete.modal.submit": "Delete Campaign",
        "campaign.update.submit": "Save Changes",

        "campaign.menu.chapters": "Chapters",

        "chapter.start": "Start Chapter",
        "chapter.start.title": "Chapter Title",
        "chapter.start.placeholder": "Name this chapter...",
        "chapter.start.cancel": "Cancel",
        "chapter.close": "Close Chapter",
        "chapter.close.modal.title": "Close Chapter",
        "chapter.close.modal.description":
          "Give this chapter its final name before sealing it into the chronicles.",
        "chapter.close.modal.label": "Chapter Title",
        "chapter.delete": "Delete",
        "chapter.delete.error":
          "Cannot delete a chapter that has quests attached.",
        "chapter.changelog": "Changelog",
        "chapter.changelog.title": "Chapter $1: $2",
        "chapter.changelog.copy": "Copy",
        "chapter.changelog.download": "Download",
        "chapter.changelog.copied": "Changelog copied to clipboard",
        "chapter.banner.active": "Active Chapter",
        "chapter.banner.title": "Chapter $1: $2",
        "chapter.list.title": "All Chapters",
        "chapter.list.empty":
          "No chapters yet. Start one to track your progress.",
        "chapter.list.noActive":
          "No active chapter. Start one to automatically track completed quests.",
        "chapter.list.quests": "$1 quest(s)",
        "chapter.list.closed": "Closed $1",

        "kanban.column.new": "New",
        "kanban.column.accepted": "In Progress",
        "kanban.column.completed": "Completed",
        "kanban.empty": "No quests",
        "kanban.showMore": "Show more",
        "kanban.readOnly": "Read only",
        "kanban.filter.all": "All",
        "kanban.error.completedCannotMove": "Completed quests cannot be moved",
        "kanban.error.acceptFirst":
          "You must accept the quest before completing it",
        "kanban.error.actionFailed": "Action failed",

        "quest.view.abandon.title": "Abandon the quest",
        "quest.view.abandon.confirm":
          "Are you sure you want to abandon this quest? You will lose all progress on this quest.",
        "quest.view.abandon.confirmButton": "Abandon Quest",
        "quest.view.edit": "Edit",
        "quest.view.notes": "Notes",
        "quest.view.notes.title": "Quest Notes",
        "quest.view.notes.placeholder": "Add your notes here...",
        "quest.view.notes.save": "Save",
        "quest.view.duplicate": "Duplicate",
        "quest.view.duplicate.title": "Duplicate Quest",
        "quest.view.duplicate.suffix": "(Copy)",
        "quest.view.timer.pause": "Pause timer",
        "quest.view.timer.start": "Start timer",
        "quest.view.timer.running": "Timer Running",
        "quest.view.timer.description":
          "Time tracking is active for this quest.",

        "quest.item.bonus": "Bonus",
        "quest.item.bonus.description": "This quest is optional.",
        "quest.item.highPriority": "High Priority !",
        "quest.item.highPriority.description": "Which means more rewards.",

        "quest.group.quests": "$1 quest(s)",

        "zone.rename.title": "Rename Zone",
        "zone.rename.name": "Zone Name",
        "zone.rename.placeholder": "Enter new zone name",
        "zone.rename.submit": "Rename",

        "stats.title": "Campaign Chronicles",
        "stats.subtitle":
          "Comprehensive insights into campaign progress and adventurer performance",
        "stats.export": "Export CSV",
        "stats.totalQuests": "Total Quests",
        "stats.completed": "Completed",
        "stats.activeAdventurers": "Active Adventurers",
        "stats.totalXp": "Total XP",
        "stats.timeline": "Activity Timeline",
        "stats.topZones": "Top 6 Zones",
        "stats.byPriority": "Quests by Priority",
        "stats.byDifficulty": "Quest Difficulty",
        "stats.noActivity": "No recent activity",
        "stats.noData": "No data available",
        "stats.noZones": "No zones yet",

        "error.title": "Oh no! Something went wrong.",
        "error.description":
          "We apologize for the inconvenience. Please try again later or contact support if the issue persists.",
        "error.back": "Back",
        "error.reload": "Reload App",
        "error.home": "Home",

        "xp.bar.title": "Experience Bar",
        "xp.bar.description":
          "Shows your current experience progress towards the next level.",

        "common.cancel": "Cancel",
        "common.error": "Error",
        "common.success": "Success",
        "common.noResults": "No results",

        "whiteboard.editQuest": "Edit Quest",
        "whiteboard.drawingSaved": "Drawing saved",
        "whiteboard.invalidImage": "Invalid image type",
        "whiteboard.imageAdded": "Image added",
        "whiteboard.uploadFailed": "Failed to upload image",
        "whiteboard.quests": "Quests",
        "whiteboard.allOnBoard": "All quests on board",
        "whiteboard.emptyCanvas": "Empty canvas",
      },
    }),
  });
  fr = $dictionary({
    lazy: async () => ({
      default: {
        "language.en": "English",
        "language.fr": "Français",

        "header.title": "Roadmap",
        "header.campaign.addQuest": "Forger une nouvelle quête",
        "header.addQuest.name": "Nom de la quête",
        "header.actions.profile": "Héros",
        "header.actions.login": "Se connecter",
        "header.actions.logout": "Deconnexion",
        "header.actions.admin": "Panneau admin",
        "header.actions.profile.level": "Niveau $1",

        "quest-log.title": "Journal des quêtes",
        "quest-log.quests": "Quêtes :",
        "quest-log.search": "Chercher par nom, zone ou difficulté...",
        "quest-log.empty":
          "Aucune quête en attente. Le royaume est bien calme...",

        "home.title": "Bienvenue dans l’aventure Roadmap",
        "home.subtitle": "Un monde où Alepha déploie toute sa magie.",
        "home.no-campaign": "Vous n’avez encore lancé aucune campagne.",
        "home.campaigns": "Campagnes",
        "home.create-campaign": "Lancer une nouvelle campagne",
        "home.lore": "Ouvrir votre Lore",
        "home.lore-description":
          "Notes markdown personnelles — recherche, tags, accès IA via MCP.",

        "lore.title": "Lore",
        "lore.search": "Rechercher dans les folios…",
        "lore.tags": "Tags",
        "lore.new": "Nouveau folio",
        "lore.new-folio": "Nouveau folio",
        "lore.edit-folio": "Modifier le folio",
        "lore.edit": "Modifier",
        "lore.delete": "Supprimer",
        "lore.save": "Enregistrer",
        "lore.back": "Retour",
        "lore.empty-list": "Aucun folio.",
        "lore.empty-folio": "(vide)",
        "lore.empty-title": "Votre Lore est vide",
        "lore.empty-subtitle":
          "Capturez vos connaissances en markdown. Taggez, recherchez, partagez avec votre IA.",
        "lore.title-placeholder": "Sans titre",
        "lore.content-placeholder": "Commencez à écrire en markdown…",
        "lore.confirm-delete-title": "Supprimer ce folio ?",
        "lore.confirm-delete-message": "Cette action est irréversible.",
        "lore.updated": "Mis à jour $1",

        "dashboard.character": "Héros",
        "dashboard.purse": "Bourse",
        "dashboard.chapter": "Chapitre actif",
        "dashboard.chapter.none": "Aucun chapitre ouvert",

        "campaign.menu.create-quest": "Créer quête",
        "campaign.menu.dashboard": "Taverne",
        "campaign.menu.board": "Tableau",
        "campaign.menu.adventurers": "Aventuriers",
        "campaign.menu.chronicles": "Chroniques",
        "campaign.menu.whiteboards": "Dessiner",
        "campaign.menu.settings": "Paramètres",

        "quest.create.submit": "Ajouter la quête à la campagne",
        "quest.create.update": "Modifier la quête",
        "quest.create.difficulty": "Difficulté",
        "quest.create.difficulty.helper":
          "Estimez le niveau de défi de cette quête",
        "quest.create.priority": "Priorité",
        "quest.create.priority.helper":
          "À quelle vitesse cette quête doit être accomplie",
        "quest.create.description": "Description de la quête",
        "quest.create.description.helper":
          "Décrivez le but, les épreuves et les détails importants.",
        "quest.create.zone": "Zone",
        "quest.create.zone.helper": "Royaume ou lieu où se déroule la quête",
        "quest.create.title": "Nom",
        "quest.create.title.helper": "Un nom court et héroïque",
        "quest.create.objectives": "Objectifs",
        "quest.create.objectives.helper":
          "Liste des objectifs pour cette quête",
        "quest.create.attachments": "Pièces jointes",
        "quest.create.attachments.helper": "Joindre des fichiers à cette quête",

        "priority.high": "Urgente",
        "priority.medium": "Normal",
        "priority.low": "Peu",
        "priority.none": "Aucune",

        "campaign.create.title": "Forger une nouvelle campagne",
        "campaign.create.description":
          "Levez votre bannière ! Créez des quêtes, recrutez des aventuriers et progressez ensemble vers la victoire.",

        "campaign.create.name": "Nom de la campagne",
        "campaign.create.name.helper": "Un nom marquant pour votre épopée.",
        "campaign.create.public": "Publique",
        "campaign.create.public.helper":
          "Si activé, votre campagne sera visible dans tout le royaume, pas seulement par vos compagnons.",
        "campaign.create.submit": "Lancer la campagne",

        "quest.view.summary":
          "Cette quête est de priorité $1 et de difficulté $2.",
        "quest.view.description": "Description",
        "quest.view.rewards": "Récompenses",
        "quest.view.receive": "Vous obtiendrez :",
        "quest.view.experience": "Expérience :",
        "quest.view.created": "forgée",
        "quest.view.actions.complete": "Marquer comme accomplie",
        "quest.view.actions.abandon": "Abandonner la quête",
        "quest.view.noObjectives": "Aucun objectif défini.",
        "quest.view.objectives": "Objectifs",
        "quest.view.attachments": "Pièces jointes",

        "quest.view.actions.accept": "Signer et accepter la quête",

        "quest.view.history": "Historique",
        "quest.view.history.assigned": "Choix courageux",
        "quest.view.history.unassigned": "Décision fatidique",
        "quest.view.history.completed": "Enfin !",
        "quest.view.history.created": "Une aube nouvelle",
        "quest.view.history.objectiveCompleted": "Objectif accompli",
        "quest.view.history.changed": "Changement notable",
        "quest.view.history.objectiveCompletedBy":
          "Un objectif a été accompli.",
        "quest.view.history.actionBy": "La quête a été $1.",
        "quest.view.history.questCompletedBy":
          "La quête a été accomplie. Victoire !",
        "quest.view.history.questCreatedBy": "Une nouvelle quête a été forgée.",

        "campaign.settings.adventurers.title": "Aventuriers",
        "campaign.settings.adventurers.empty":
          "Aucun aventurier dans cette campagne pour le moment.",
        "campaign.settings.adventurers.invite.action": "Inviter",
        "campaign.settings.adventurers.invite.title": "Inviter un aventurier",
        "campaign.settings.adventurers.invite.description":
          "Entrez l'adresse e-mail de l'aventurier que vous souhaitez inviter dans « $1 ».",
        "campaign.settings.adventurers.invite.email": "Adresse e-mail",
        "campaign.settings.adventurers.invite.cancel": "Annuler",
        "campaign.settings.adventurers.invite.submit": "Envoyer l'invitation",

        "campaign.settings.danger.title": "Zone à risques",
        "campaign.settings.actions.delete": "Détruire cette campagne",
        "campaign.settings.actions.delete.helper":
          "Parfois, il faut abandonner le combat… mais sachez que toutes les quêtes et les progrès seront perdus.",

        "campaign.settings.general.title": "Général",
        "campaign.settings.whiteboard": "Tableau blanc",
        "campaign.settings.whiteboard.helper":
          "Activer le canevas de dessin pour esquisser vos plans et cartographier vos quêtes.",
        "campaign.settings.character.title": "Personnage",
        "campaign.settings.character.level": "Niveau $1",
        "campaign.settings.character.nextLevel":
          "$1 XP avant le prochain niveau",
        "campaign.settings.character.balance": "Bourse",
        "campaign.settings.delete.modal.title": "Détruire la campagne",
        "campaign.settings.delete.modal.description":
          "Cette action est irréversible. La campagne et toutes ses quêtes seront définitivement perdues.",
        "campaign.settings.delete.modal.confirm": "Tapez $1 pour confirmer :",
        "campaign.settings.delete.modal.cancel": "Annuler",
        "campaign.settings.delete.modal.submit": "Détruire la campagne",
        "campaign.update.submit": "Modifier",

        "campaign.menu.chapters": "Chapitres",

        "chapter.start": "Ouvrir un chapitre",
        "chapter.start.title": "Titre du chapitre",
        "chapter.start.placeholder": "Nommez ce chapitre...",
        "chapter.start.cancel": "Annuler",
        "chapter.close": "Clore le chapitre",
        "chapter.close.modal.title": "Clore le chapitre",
        "chapter.close.modal.description":
          "Donnez un nom définitif à ce chapitre avant de le sceller dans les chroniques.",
        "chapter.close.modal.label": "Titre du chapitre",
        "chapter.delete": "Supprimer",
        "chapter.delete.error":
          "Impossible de supprimer un chapitre contenant des quêtes.",
        "chapter.changelog": "Changelog",
        "chapter.changelog.title": "Chapitre $1 : $2",
        "chapter.changelog.copy": "Copier",
        "chapter.changelog.download": "Télécharger",
        "chapter.changelog.copied": "Changelog copié dans le presse-papier",
        "chapter.banner.active": "Chapitre actif",
        "chapter.banner.title": "Chapitre $1 : $2",
        "chapter.list.title": "Tous les chapitres",
        "chapter.list.empty":
          "Aucun chapitre pour le moment. Lancez-en un pour suivre votre avancée.",
        "chapter.list.noActive":
          "Aucun chapitre actif. Ouvrez-en un pour enregistrer automatiquement les quêtes accomplies.",
        "chapter.list.quests": "$1 quête(s)",
        "chapter.list.closed": "Clos le $1",

        "kanban.column.new": "Nouvelles",
        "kanban.column.accepted": "En cours",
        "kanban.column.completed": "Terminées",
        "kanban.empty": "Aucune quête",
        "kanban.showMore": "Afficher plus",
        "kanban.readOnly": "Lecture seule",
        "kanban.filter.zones": "Zones",
        "kanban.error.completedCannotMove":
          "Les quêtes terminées ne peuvent pas être déplacées",
        "kanban.error.acceptFirst":
          "Vous devez d'abord accepter la quête avant de la terminer",
        "kanban.error.actionFailed": "L'action a échoué",

        "quest.view.abandon.title": "Abandonner la quête",
        "quest.view.abandon.confirm":
          "Êtes-vous sûr de vouloir abandonner cette quête ? Vous perdrez toute progression.",
        "quest.view.abandon.confirmButton": "Abandonner la quête",
        "quest.view.edit": "Modifier",
        "quest.view.notes": "Notes",
        "quest.view.notes.title": "Notes de quête",
        "quest.view.notes.placeholder": "Ajoutez vos notes ici...",
        "quest.view.notes.save": "Enregistrer",
        "quest.view.duplicate": "Dupliquer",
        "quest.view.duplicate.title": "Dupliquer la quête",
        "quest.view.duplicate.suffix": "(Copie)",
        "quest.view.timer.pause": "Mettre en pause",
        "quest.view.timer.start": "Démarrer le chrono",
        "quest.view.timer.running": "Chrono actif",
        "quest.view.timer.description":
          "Le suivi du temps est actif pour cette quête.",

        "quest.item.bonus": "Bonus",
        "quest.item.bonus.description": "Cette quête est optionnelle.",
        "quest.item.highPriority": "Priorité haute !",
        "quest.item.highPriority.description":
          "Ce qui signifie plus de récompenses.",

        "quest.group.quests": "$1 quête(s)",

        "zone.rename.title": "Renommer la zone",
        "zone.rename.name": "Nom de la zone",
        "zone.rename.placeholder": "Entrez le nouveau nom de la zone",
        "zone.rename.submit": "Renommer",

        "stats.title": "Chroniques de campagne",
        "stats.subtitle":
          "Un aperçu complet de la progression de la campagne et des performances des aventuriers",
        "stats.export": "Exporter CSV",
        "stats.totalQuests": "Total quêtes",
        "stats.completed": "Terminées",
        "stats.activeAdventurers": "Aventuriers actifs",
        "stats.totalXp": "XP totale",
        "stats.timeline": "Chronologie d'activité",
        "stats.topZones": "Top 6 des zones",
        "stats.byPriority": "Quêtes par priorité",
        "stats.byDifficulty": "Difficulté des quêtes",
        "stats.noActivity": "Aucune activité récente",
        "stats.noData": "Aucune donnée disponible",
        "stats.noZones": "Aucune zone pour le moment",

        "error.title": "Oups ! Quelque chose s'est mal passé.",
        "error.description":
          "Nous nous excusons pour le désagrément. Veuillez réessayer plus tard ou contacter le support.",
        "error.back": "Retour",
        "error.reload": "Recharger",
        "error.home": "Accueil",

        "xp.bar.title": "Barre d'expérience",
        "xp.bar.description":
          "Affiche votre progression actuelle vers le prochain niveau.",

        "common.cancel": "Annuler",
        "common.error": "Erreur",
        "common.success": "Succès",
        "common.noResults": "Aucun résultat",

        "whiteboard.editQuest": "Modifier la quête",
        "whiteboard.drawingSaved": "Dessin sauvegardé",
        "whiteboard.invalidImage": "Type d'image invalide",
        "whiteboard.imageAdded": "Image ajoutée",
        "whiteboard.uploadFailed": "Échec de l'envoi de l'image",
        "whiteboard.quests": "Quêtes",
        "whiteboard.allOnBoard": "Toutes les quêtes sont sur le tableau",
        "whiteboard.emptyCanvas": "Canevas vide",
      },
    }),
  });
}
