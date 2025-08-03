import { $dictionary } from "@alepha/react-i18n";

export class I18n {
	en = $dictionary({
		lazy: async () => ({
			default: {
				en: "English",
				fr: "Français",
				"roadmap.title": "Roadmap",
				"roadmap.header.addTask": "Create New Task",
				"roadmap.header.addTask.name": "Task Name",
				"roadmap.item.createdAt": "created $1 at $2",
			},
		}),
	});
	fr = $dictionary({
		lazy: async () => ({
			default: {
				"roadmap.title": "Feuille de route",
				"roadmap.header.addTask": "Créer une nouvelle tâche",
				"roadmap.header.addTask.name": "Nom de la tâche",
				"roadmap.item.createdAt": "créé le $1 à $2",
			},
		}),
	});
}
