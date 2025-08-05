import { $dictionary } from "@alepha/react-i18n";

export class I18n {
	en = $dictionary({
		lazy: async () => ({
			default: {
				en: "English",
				fr: "Français",
				"roadmap.title": "Roadmap",
				"roadmap.subtitle": "What a Waste of Time",
				"roadmap.header.addTask": "Create New Quest",
				"roadmap.header.addTask.name": "Task Name",
				"roadmap.item.createdAt": "Created $1 at $2",
				"roadmap.quest-log.title": "Quest Log",
				"roadmap.quest-log.quests": "Quests:",
				"roadmap.quest-log.search": "Find by name, package, or complexity...",
				"roadmap.quest-log.empty": "No quests available.",
				"roadmap.home.title": "Welcome to the Roadmap App",
				"roadmap.home.subtitle":
					"This is a sample app to demonstrate Alepha's capabilities.",
			},
		}),
	});
	fr = $dictionary({
		lazy: async () => ({
			default: {
				"roadmap.title": "Feuille de Route",
				"roadmap.subtitle": "Quelle Perte de Temps !",
				"roadmap.header.addTask": "Créer une nouvelle tâche",
				"roadmap.header.addTask.name": "Nom de la tâche",
				"roadmap.item.createdAt": "créé le $1 à $2",
				"roadmap.quest-log.title": "Journal",
				"roadmap.quest-log.quests": "Quêtes:",
				"roadmap.quest-log.search":
					"Rechercher par nom, package ou complexité...",
				"roadmap.quest-log.empty": "Aucune quête disponible.",
				"roadmap.home.title": "Bienvenue dans l'application Feuille de Route",
				"roadmap.home.subtitle":
					"Ceci est une application d'exemple pour démontrer les capacités d'Alepha.",
			},
		}),
	});
}
