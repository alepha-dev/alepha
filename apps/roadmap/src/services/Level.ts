import type { Task } from "../api/providers/Db.ts";

export class Level {
	levels = [
		1080, 2200, 4800, 8400, 13000, 19000, 27000, 37000, 49000, 63000, 79000,
		97000, 117000, 139000, 163000, 189000, 217000, 247000,
	];

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
			task.priority === "high" ? 350 : task.priority === "medium" ? 180 : 80;
		return task.complexity * 150 + priority;
	}

	getLevelByXp(xp: number): number {
		if (xp < 0) return 0;
		if (xp >= this.levels[this.levels.length - 1]) return this.levels.length;

		for (let i = 0; i < this.levels.length; i++) {
			if (xp < this.levels[i]) {
				return i + 1;
			}
		}

		return this.levels.length - 1; // Fallback to the last level if not found
	}

	getNextXpForLevel(xp: number): number {
		const level = this.getLevelByXp(xp);
		return this.getMaxXpForLevel(level) - this.getCurrentXpForLevel(level, xp);
	}

	getMaxXpForLevel(level: number): number {
		const index = level - 1;
		if (index < 0 || index >= this.levels.length) {
			throw new Error(`Invalid level: ${level}`);
		}
		return this.levels[index];
	}

	getCurrentXpForLevel(level: number, xp: number): number {
		if (level === 1) {
			return xp;
		}
		return xp - this.getMaxXpForLevel(level - 1);
	}
}
