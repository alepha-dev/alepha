import type { Task } from "../providers/Db.ts";

export class CharacterInfo {
	levels = [
		1080, 2200, 4800, 8400, 13000, 19000, 27000, 37000, 49000, 63000, 79000,
		97000, 117000, 139000, 163000, 189000, 217000, 247000,
	];

	/**
	 * Get rank of the quest based on its complexity. It's not for user level.
	 */
	getRank(n: number): string {
		if (n === 2) return "C";
		if (n === 3) return "B";
		if (n === 4) return "A";
		if (n === 5) return "S";
		return "F";
	}

	getMoneyFromTask(task: Task): number {
		const baseMoney = task.complexity * 40;
		const priorityBonus =
			task.priority === "high" ? 200 : task.priority === "medium" ? 100 : 0;
		return baseMoney + priorityBonus;
	}

	getGold(balance: number): number {
		return Math.floor(balance / 100);
	}

	getSilver(balance: number): number {
		return balance % 100;
	}

	getXpFromTask(task: Task) {
		const priority =
			task.priority === "high" ? 300 : task.priority === "medium" ? 180 : 80;
		return task.complexity * 150 + priority;
	}

	getLevelByXp(xp: number): number {
		if (xp < 0) return 0;

		let acc = 0;
		for (let i = 0; i < this.levels.length; i++) {
			acc += this.levels[i];

			if (xp < acc) {
				return i + 1;
			}
		}

		return this.levels.length - 1; // Fallback to the last level if not found
	}

	getNextXpForLevel(xp: number): number {
		return this.geGlobalMaxXpForLevel(this.getLevelByXp(xp)) - xp;
	}

	getMaxXpForLevel(level: number): number {
		const index = level - 1;
		if (index < 0 || index >= this.levels.length) {
			throw new Error(`Invalid level: ${level}`);
		}
		return this.levels[index];
	}

	geGlobalMaxXpForLevel(level: number): number {
		const index = level - 1;
		if (index < 0 || index >= this.levels.length) {
			throw new Error(`Invalid level: ${level}`);
		}
		let acc = 0;
		for (let i = 0; i <= index; i++) {
			acc += this.levels[i];
		}
		return acc;
	}

	getCurrentXpForLevel(level: number, xp: number): number {
		if (level === 1) {
			return xp;
		}
		return xp - this.geGlobalMaxXpForLevel(level - 1);
	}
}
