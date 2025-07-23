import { Alepha } from "@alepha/core";
import { ServerProvider } from "@alepha/server";
import { afterEach, expect, test } from "vitest";
import {
	$client,
	$remote,
	AlephaServerLinks,
	type HttpVirtualClient,
} from "../src";
import { CrudApp } from "./fixtures/CrudApp.ts";

const ctx = Alepha.create({
	env: {},
}).with(AlephaServerLinks);

const app = ctx.get(CrudApp);
const linkLocal = ctx.get(
	class Client {
		client = $client<CrudApp>();
	},
).client;

const linkRemote = Alepha.create()
	.with(AlephaServerLinks)
	.get(
		class Client {
			client = $client<CrudApp>();
			app = $remote({
				url: () => ctx.get(ServerProvider).hostname,
			});
		},
	).client;

afterEach(() => {
	app.clear();
});

const testActionBasicCrud = async (
	app: CrudApp | HttpVirtualClient<CrudApp>,
) => {
	expect(await app.findAll.run()).toEqual([]);
	expect(await app.findAll.run()).toEqual([]);

	expect(await app.create.run({ body: { name: "John" } })).toEqual({
		id: 1,
		name: "John",
	});

	expect(await app.create.run({ body: { name: "Jean" } })).toEqual({
		id: 2,
		name: "Jean",
	});

	expect(await app.findAll.run()).toEqual([
		{
			id: 1,
			name: "John",
		},
		{
			id: 2,
			name: "Jean",
		},
	]);

	expect(
		await app.findAll.run({
			query: { name: "John" },
		}),
	).toEqual([
		{
			id: 1,
			name: "John",
		},
	]);

	expect(
		await app.findAll.run({
			query: { name: "J" },
		}),
	).toEqual([
		{
			id: 1,
			name: "John",
		},
		{
			id: 2,
			name: "Jean",
		},
	]);

	expect(await app.findAll.run()).toEqual([
		{
			id: 1,
			name: "John",
		},
		{
			id: 2,
			name: "Jean",
		},
	]);

	expect(await app.findById.run({ params: { id: 1 } })).toEqual({
		id: 1,
		name: "John",
	});

	expect(await app.findById.run({ params: { id: 2 } })).toEqual({
		id: 2,
		name: "Jean",
	});

	expect(
		await app.update.run({ params: { id: 1 }, body: { name: "John Doe" } }),
	).toEqual({
		id: 1,
		name: "John Doe",
	});

	expect(await app.findById.run({ params: { id: 1 } })).toEqual({
		id: 1,
		name: "John Doe",
	});

	expect(
		await app.update.run({ params: { id: 1 }, body: { name: "Rasmus" } }),
	).toEqual({
		id: 1,
		name: "Rasmus",
	});

	expect(await app.findById.run({ params: { id: 1 } })).toEqual({
		id: 1,
		name: "Rasmus",
	});

	expect(await app.delete.run({ params: { id: 1 } })).toEqual(undefined);

	expect(await app.findAll.run()).toEqual([
		{
			id: 2,
			name: "Jean",
		},
	]);
};

test("$action - basic crud (app)", async () => {
	await testActionBasicCrud(app);
});

test("$action - basic crud (linkLocal)", async () => {
	await testActionBasicCrud(linkLocal);
});

test("$action - basic crud (linkRemote)", async () => {
	await testActionBasicCrud(linkRemote);
});

const testActionHeader = async (app: CrudApp | HttpVirtualClient<CrudApp>) => {
	expect(await app.findAll.run()).toEqual([]);
	expect(await app.create.run({ body: { name: "Jean" } })).toEqual({
		id: 1,
		name: "Jean",
	});

	expect(
		await app.findById.run({
			params: { id: 1 },
			headers: { uppercase: true },
		}),
	).toEqual({
		id: 1,
		name: "JEAN",
	});

	expect(
		await app.findById.run({ params: { id: 1 }, headers: { uppercase: true } }),
	).toEqual({
		id: 1,
		name: "JEAN",
	});

	expect(
		await app.findById.run({
			params: { id: 1 },
			headers: { uppercase: true },
		}),
	).toEqual({
		id: 1,
		name: "JEAN",
	});
};

test("$action - headers (app)", async () => {
	await testActionHeader(app);
});

test("$action - headers (linkLocal)", async () => {
	await testActionHeader(linkLocal);
});

test("$action - headers (linkRemote)", async () => {
	await testActionHeader(linkRemote);
});

const testActionErrors = async (app: CrudApp | HttpVirtualClient<CrudApp>) => {
	await expect(app.findById.run({ params: { id: 2 } })).rejects.toThrowError(
		"User not found",
	);

	// as local function, we go the real error
	// as remove function, we go the http error wrapper
	await expect(app.internalError.run()).rejects.toThrowError("Oops");
};

test("$action - errors (app)", async () => {
	await testActionErrors(app);
});

test("$action - errors (linkLocal)", async () => {
	await testActionErrors(linkLocal);
});

test("$action - errors (linkRemote)", async () => {
	await testActionErrors(linkRemote);
});

// TODO - with security (on/off) + forward

// TODO - body parser (multipart)
