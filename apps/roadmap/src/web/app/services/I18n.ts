import { $dictionary } from "alepha/react/i18n";

export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        en: "English",
        fr: "Français",

        "header.title": "Roadmap",
        "header.project.addTask": "Create New Quest",
        "header.addTask.name": "Task Name",
        "header.actions.profile": "Profile",
        "header.actions.login": "Sign In",
        "header.actions.logout": "Logout",
        "header.actions.profile.level": "Level $1",

        "quest-log.quests": "Quests:",
        "quest-log.search": "Find by name, zone...",
        "quest-log.empty": "No quests available.",

        "home.title": "Welcome to the Roadmap App",
        "home.subtitle":
          "This is a sample app to demonstrate Alepha's capabilities.",
        "home.no-campaign": "You don't have any campaigns yet.",
        "home.campaigns": "Your recent campaigns",
        "home.create-campaign": "New Campaign",

        "project.menu.create-task": "Create Quest",
        "project.menu.board": "Board",
        "project.menu.players": "Players",
        "project.menu.analytics": "Analytics",
        "project.menu.whiteboards": "Draw",
        "project.menu.settings": "Settings",

        "task.create.submit": "Add Quest to Campaign",
        "task.create.complexity": "Difficulty",
        "task.create.complexity.helper": "Rank the quest's complexity",
        "task.create.priority": "Priority",
        "task.create.priority.helper": "How fast quest should be completed",
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
          "Start a new campaign ! Create your quests, invite some players and progress together to complete it.",

        "project.create.name": "Campaign Name",
        "project.create.name.helper":
          "Set a short name for identifying your campaign.",
        "project.create.public": "Public",
        "project.create.public.helper":
          "If enabled, your campaign will be visible to everyone. Not only you and campaign's players.",
        "project.create.submit": "Create Campaign",

        "task.view.summary":
          "This quest is on a $1 priority level. Complexity is $2 tier.",
        "task.view.description": "Description",
        "task.view.rewards": "Rewards",
        "task.view.receive": "You will receive:",
        "task.view.experience": "Experience:",
        "task.view.created": "created",
        "task.view.actions.complete": "Mark as Completed",
        "task.view.actions.abandon": "Abandon Quest",
        "task.view.noObjectives": "No objectives defined.",
        "task.view.objectives": "Objectives",
        "task.view.attachments": "Attachments",

        "task.view.actions.accept": "Sign and Accept the Quest",

        "project.settings.danger.title": "Danger Zone",
        "project.settings.actions.delete": "Delete this campaign",
        "project.settings.actions.delete.helper":
          "Giving up is hard, but sometimes it's the best option. All quests and progress will be lost.",

        "project.settings.general.title": "General",
        "project.update.submit": "Save Changes",
      },
    }),
  });
  fr = $dictionary({
    lazy: async () => ({
      default: {
        "header.title": "Roadmap",
        "header.project.addTask": "Forger une nouvelle quête",
        "header.addTask.name": "Nom de la mission",
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

        "project.settings.danger.title": "Zone à risques",
        "project.settings.actions.delete": "Détruire cette campagne",
        "project.settings.actions.delete.helper":
          "Parfois, il faut abandonner le combat… mais sachez que toutes les quêtes et les progrès seront perdus.",

        "project.settings.general.title": "Général",
        "project.update.submit": "Modifier",
      },
    }),
  });
}
