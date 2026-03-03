import { $dictionary } from "alepha/react/i18n";

export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        en: "English",
        fr: "Français",

        "header.title": "Roadmap",
        "header.project.addTask": "Create New Quest",
        "header.addTask.name": "Quest Name",
        "header.actions.profile": "Profile",
        "header.actions.login": "Sign In",
        "header.actions.logout": "Logout",
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

        "project.menu.create-task": "Create Quest",
        "project.menu.board": "Board",
        "project.menu.players": "Adventurers",
        "project.menu.analytics": "Chronicles",
        "project.menu.whiteboards": "Draw",
        "project.menu.settings": "Settings",

        "task.create.submit": "Add Quest to Campaign",
        "task.create.update": "Update Quest",
        "task.create.complexity": "Difficulty",
        "task.create.complexity.helper":
          "Rate how challenging this quest will be",
        "task.create.priority": "Priority",
        "task.create.priority.helper":
          "How urgently this quest must be fulfilled",
        "task.create.description": "Quest Description",
        "task.create.description.helper":
          "Describe the quest, its objectives, and any relevant details",
        "task.create.package": "Zone",
        "task.create.package.helper": "Where the quest takes place",
        "task.create.title": "Name",
        "task.create.title.helper": "Short and descriptive name",
        "task.create.objectives": "Objectives",
        "task.create.objectives.helper": "List of objectives for this quest",
        "task.create.attachments": "Attachments",
        "task.create.attachments.helper": "Attach files to this quest",

        "priority.high": "High",
        "priority.medium": "Normal",
        "priority.low": "Low",
        "priority.none": "None",

        "project.create.title": "Create a new campaign",
        "project.create.description":
          "Raise your banner! Forge quests, recruit adventurers and progress together toward victory.",

        "project.create.name": "Campaign Name",
        "project.create.name.helper":
          "Set a short name for identifying your campaign.",
        "project.create.public": "Public",
        "project.create.public.helper":
          "If enabled, your campaign will be visible across the realm, not just to you and your adventurers.",
        "project.create.submit": "Create Campaign",

        "task.view.summary": "This quest has $1 priority. Difficulty tier: $2.",
        "task.view.description": "Description",
        "task.view.rewards": "Rewards",
        "task.view.receive": "You will receive:",
        "task.view.experience": "Experience:",
        "task.view.created": "created",
        "task.view.actions.complete": "Complete Quest",
        "task.view.actions.abandon": "Abandon Quest",
        "task.view.noObjectives": "No objectives for this quest.",
        "task.view.objectives": "Objectives",
        "task.view.attachments": "Attachments",

        "task.view.actions.accept": "Sign and Accept the Quest",

        "task.view.history": "History",
        "task.view.history.assigned": "Courageous Choice",
        "task.view.history.unassigned": "Fateful Decision",
        "task.view.history.completed": "At Long Last",
        "task.view.history.created": "A New Dawn",
        "task.view.history.objectiveCompleted": "Objective Achieved",
        "task.view.history.changed": "Notable Change",
        "task.view.history.objectiveCompletedBy":
          "An objective has been fulfilled.",
        "task.view.history.actionBy": "Quest has been $1.",
        "task.view.history.questCompletedBy":
          "The quest has been completed. Victory!",
        "task.view.history.questCreatedBy": "A new quest has been forged.",

        "project.settings.players.title": "Adventurers",
        "project.settings.players.empty":
          "No adventurers in this campaign yet.",
        "project.settings.players.invite.action": "Invite",
        "project.settings.players.invite.title": "Invite Adventurer",
        "project.settings.players.invite.description":
          'Enter the email address of the adventurer you want to invite to "$1".',
        "project.settings.players.invite.email": "Email Address",
        "project.settings.players.invite.cancel": "Cancel",
        "project.settings.players.invite.submit": "Send Invitation",

        "project.settings.danger.title": "Danger Zone",
        "project.settings.actions.delete": "Delete this campaign",
        "project.settings.actions.delete.helper":
          "Sometimes retreat is the only option. All quests and progress will be lost forever.",

        "project.settings.general.title": "General",
        "project.settings.whiteboard": "Whiteboard",
        "project.settings.whiteboard.helper":
          "Enable the drawing canvas to sketch plans and map out your quests.",
        "project.settings.character.title": "Character",
        "project.settings.character.level": "Level $1",
        "project.settings.character.nextLevel": "$1 XP to next level",
        "project.settings.character.balance": "Balance",
        "project.settings.delete.modal.title": "Delete Campaign",
        "project.settings.delete.modal.description":
          "This action cannot be undone. This will permanently destroy the campaign and all its quests.",
        "project.settings.delete.modal.confirm": "Please type $1 to confirm:",
        "project.settings.delete.modal.cancel": "Cancel",
        "project.settings.delete.modal.submit": "Delete Campaign",
        "project.update.submit": "Save Changes",

        "project.menu.chapters": "Chapters",

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
        "kanban.readOnly": "Read only",
        "kanban.filter.all": "All",
        "kanban.error.completedCannotMove": "Completed quests cannot be moved",
        "kanban.error.acceptFirst":
          "You must accept the quest before completing it",
        "kanban.error.actionFailed": "Action failed",

        "task.view.abandon.title": "Abandon the quest",
        "task.view.abandon.confirm":
          "Are you sure you want to abandon this quest? You will lose all progress on this task.",
        "task.view.abandon.confirmButton": "Abandon Quest",
        "task.view.edit": "Edit",
        "task.view.notes": "Notes",
        "task.view.notes.title": "Quest Notes",
        "task.view.notes.placeholder": "Add your notes here...",
        "task.view.notes.save": "Save",
        "task.view.duplicate": "Duplicate",
        "task.view.duplicate.title": "Duplicate Quest",
        "task.view.duplicate.suffix": "(Copy)",
        "task.view.timer.pause": "Pause timer",
        "task.view.timer.start": "Start timer",
        "task.view.timer.running": "Timer Running",
        "task.view.timer.description":
          "Time tracking is active for this quest.",

        "task.item.bonus": "Bonus",
        "task.item.bonus.description": "This quest is optional.",
        "task.item.highPriority": "High Priority !",
        "task.item.highPriority.description": "Which means more rewards.",

        "task.group.quests": "$1 quest(s)",

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
        "stats.byComplexity": "Quest Difficulty",
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

        "whiteboard.editTask": "Edit Task",
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
        "header.title": "Roadmap",
        "header.project.addTask": "Forger une nouvelle quête",
        "header.addTask.name": "Nom de la quête",
        "header.actions.profile": "Héros",
        "header.actions.login": "Se connecter",
        "header.actions.logout": "Deconnexion",
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

        "project.menu.create-task": "Créer quête",
        "project.menu.board": "Tableau",
        "project.menu.players": "Aventuriers",
        "project.menu.analytics": "Chroniques",
        "project.menu.whiteboards": "Dessiner",
        "project.menu.settings": "Paramètres",

        "task.create.submit": "Ajouter la quête à la campagne",
        "task.create.update": "Modifier la quête",
        "task.create.complexity": "Difficulté",
        "task.create.complexity.helper":
          "Estimez le niveau de défi de cette quête",
        "task.create.priority": "Priorité",
        "task.create.priority.helper":
          "À quelle vitesse cette quête doit être accomplie",
        "task.create.description": "Description de la quête",
        "task.create.description.helper":
          "Décrivez le but, les épreuves et les détails importants.",
        "task.create.package": "Zone",
        "task.create.package.helper": "Royaume ou lieu où se déroule la quête",
        "task.create.title": "Nom",
        "task.create.title.helper": "Un nom court et héroïque",
        "task.create.objectives": "Objectifs",
        "task.create.objectives.helper": "Liste des objectifs pour cette quête",
        "task.create.attachments": "Pièces jointes",
        "task.create.attachments.helper": "Joindre des fichiers à cette quête",

        "priority.high": "Urgente",
        "priority.medium": "Normal",
        "priority.low": "Peu",
        "priority.none": "Aucune",

        "project.create.title": "Forger une nouvelle campagne",
        "project.create.description":
          "Levez votre bannière ! Créez des quêtes, recrutez des aventuriers et progressez ensemble vers la victoire.",

        "project.create.name": "Nom de la campagne",
        "project.create.name.helper": "Un nom marquant pour votre épopée.",
        "project.create.public": "Publique",
        "project.create.public.helper":
          "Si activé, votre campagne sera visible dans tout le royaume, pas seulement par vos compagnons.",
        "project.create.submit": "Lancer la campagne",

        "task.view.summary":
          "Cette quête est de priorité $1 et de difficulté $2.",
        "task.view.description": "Description",
        "task.view.rewards": "Récompenses",
        "task.view.receive": "Vous obtiendrez :",
        "task.view.experience": "Expérience :",
        "task.view.created": "forgée",
        "task.view.actions.complete": "Marquer comme accomplie",
        "task.view.actions.abandon": "Abandonner la quête",
        "task.view.noObjectives": "Aucun objectif défini.",
        "task.view.objectives": "Objectifs",
        "task.view.attachments": "Pièces jointes",

        "task.view.actions.accept": "Signer et accepter la quête",

        "task.view.history": "Historique",
        "task.view.history.assigned": "Choix courageux",
        "task.view.history.unassigned": "Décision fatidique",
        "task.view.history.completed": "Enfin !",
        "task.view.history.created": "Une aube nouvelle",
        "task.view.history.objectiveCompleted": "Objectif accompli",
        "task.view.history.changed": "Changement notable",
        "task.view.history.objectiveCompletedBy": "Un objectif a été accompli.",
        "task.view.history.actionBy": "La quête a été $1.",
        "task.view.history.questCompletedBy":
          "La quête a été accomplie. Victoire !",
        "task.view.history.questCreatedBy": "Une nouvelle quête a été forgée.",

        "project.settings.players.title": "Aventuriers",
        "project.settings.players.empty":
          "Aucun aventurier dans cette campagne pour le moment.",
        "project.settings.players.invite.action": "Inviter",
        "project.settings.players.invite.title": "Inviter un aventurier",
        "project.settings.players.invite.description":
          "Entrez l'adresse e-mail de l'aventurier que vous souhaitez inviter dans « $1 ».",
        "project.settings.players.invite.email": "Adresse e-mail",
        "project.settings.players.invite.cancel": "Annuler",
        "project.settings.players.invite.submit": "Envoyer l'invitation",

        "project.settings.danger.title": "Zone à risques",
        "project.settings.actions.delete": "Détruire cette campagne",
        "project.settings.actions.delete.helper":
          "Parfois, il faut abandonner le combat… mais sachez que toutes les quêtes et les progrès seront perdus.",

        "project.settings.general.title": "Général",
        "project.settings.whiteboard": "Tableau blanc",
        "project.settings.whiteboard.helper":
          "Activer le canevas de dessin pour esquisser vos plans et cartographier vos quêtes.",
        "project.settings.character.title": "Personnage",
        "project.settings.character.level": "Niveau $1",
        "project.settings.character.nextLevel":
          "$1 XP avant le prochain niveau",
        "project.settings.character.balance": "Bourse",
        "project.settings.delete.modal.title": "Détruire la campagne",
        "project.settings.delete.modal.description":
          "Cette action est irréversible. La campagne et toutes ses quêtes seront définitivement perdues.",
        "project.settings.delete.modal.confirm": "Tapez $1 pour confirmer :",
        "project.settings.delete.modal.cancel": "Annuler",
        "project.settings.delete.modal.submit": "Détruire la campagne",
        "project.update.submit": "Modifier",

        "project.menu.chapters": "Chapitres",

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
        "kanban.readOnly": "Lecture seule",
        "kanban.filter.packages": "Zones",
        "kanban.error.completedCannotMove":
          "Les quêtes terminées ne peuvent pas être déplacées",
        "kanban.error.acceptFirst":
          "Vous devez d'abord accepter la quête avant de la terminer",
        "kanban.error.actionFailed": "L'action a échoué",

        "task.view.abandon.title": "Abandonner la quête",
        "task.view.abandon.confirm":
          "Êtes-vous sûr de vouloir abandonner cette quête ? Vous perdrez toute progression.",
        "task.view.abandon.confirmButton": "Abandonner la quête",
        "task.view.edit": "Modifier",
        "task.view.notes": "Notes",
        "task.view.notes.title": "Notes de quête",
        "task.view.notes.placeholder": "Ajoutez vos notes ici...",
        "task.view.notes.save": "Enregistrer",
        "task.view.duplicate": "Dupliquer",
        "task.view.duplicate.title": "Dupliquer la quête",
        "task.view.duplicate.suffix": "(Copie)",
        "task.view.timer.pause": "Mettre en pause",
        "task.view.timer.start": "Démarrer le chrono",
        "task.view.timer.running": "Chrono actif",
        "task.view.timer.description":
          "Le suivi du temps est actif pour cette quête.",

        "task.item.bonus": "Bonus",
        "task.item.bonus.description": "Cette quête est optionnelle.",
        "task.item.highPriority": "Priorité haute !",
        "task.item.highPriority.description":
          "Ce qui signifie plus de récompenses.",

        "task.group.quests": "$1 quête(s)",

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
        "stats.byComplexity": "Difficulté des quêtes",
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

        "whiteboard.editTask": "Modifier la quête",
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
