import { Alepha } from "@alepha/core";
import { afterEach, expect, test } from "vitest";
import { $remote, HttpClient } from "../src";
import { ServerProvider } from "../src/providers/platforms/ServerProvider.ts";
import { CrudApi, CrudApp } from "./fixtures/CrudApp.ts";

const ctx = Alepha.create({
	env: {
		SERVER_LINKS_ENABLED: true,
	},
});
const app = ctx.get(CrudApp);
const api = ctx.get(CrudApi);

const ctxRemote = Alepha.create();
const apiRemote = ctxRemote.get(CrudApi);

ctxRemote.with(
	class RemoteServices {
		crud = $remote({
			url: () => ctx.get(ServerProvider).hostname,
			services: apiRemote,
		});
	},
);

const ctxClientLocal = Alepha.create();
const apiClientLocal = ctxClientLocal.get(HttpClient).of<CrudApp>({
	host: () => ctx.get(ServerProvider).hostname,
});

const ctxClientRemote = Alepha.create();
const apiClientRemote = ctxClientLocal.get(HttpClient).of<CrudApp>({
	host: () => ctx.get(ServerProvider).hostname,
});

afterEach(() => {
	app.clear();
});

const testActionBasicCrud = async (app: CrudApi) => {
	expect(await app.findAll()).toEqual([]);
	expect(await app.findAll.fetch({})).toEqual([]);

	expect(await app.create.fetch({ body: { name: "John" } })).toEqual({
		id: 1,
		name: "John",
	});

	expect(await app.create({ body: { name: "Jean" } })).toEqual({
		id: 2,
		name: "Jean",
	});

	expect(await app.findAll()).toEqual([
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
		await app.findAll({
			query: { name: "John" },
		}),
	).toEqual([
		{
			id: 1,
			name: "John",
		},
	]);

	expect(
		await app.findAll({
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

	expect(await app.findAll.fetch()).toEqual([
		{
			id: 1,
			name: "John",
		},
		{
			id: 2,
			name: "Jean",
		},
	]);

	expect(await app.findById.fetch({ params: { id: 1 } })).toEqual({
		id: 1,
		name: "John",
	});

	expect(await app.findById({ params: { id: 2 } })).toEqual({
		id: 2,
		name: "Jean",
	});

	expect(
		await app.update.fetch({ params: { id: 1 }, body: { name: "John Doe" } }),
	).toEqual({
		id: 1,
		name: "John Doe",
	});

	expect(await app.findById({ params: { id: 1 } })).toEqual({
		id: 1,
		name: "John Doe",
	});

	expect(
		await app.update({ params: { id: 1 }, body: { name: "Rasmus" } }),
	).toEqual({
		id: 1,
		name: "Rasmus",
	});

	expect(await app.findById({ params: { id: 1 } })).toEqual({
		id: 1,
		name: "Rasmus",
	});

	expect(await app.delete({ params: { id: 1 } })).toEqual(undefined);

	expect(await app.findAll.fetch()).toEqual([
		{
			id: 2,
			name: "Jean",
		},
	]);
};

test("$action - basic crud (app)", async () => {
	await testActionBasicCrud(app);
});

test("$action - basic crud (api)", async () => {
	await testActionBasicCrud(api);
});

test("$action - basic crud (remote)", async () => {
	await testActionBasicCrud(apiRemote);
});

test("$action - basic crud (client-remote)", async () => {
	await testActionBasicCrud(apiClientRemote);
});

test("$action - basic crud (client-local)", async () => {
	await testActionBasicCrud(apiClientLocal);
});

const testActionHeader = async (app: CrudApi) => {
	expect(await app.findAll()).toEqual([]);
	expect(await app.create({ body: { name: "Jean" } })).toEqual({
		id: 1,
		name: "Jean",
	});

	expect(
		await app.findById.fetch({
			params: { id: 1 },
			headers: { uppercase: true },
		}),
	).toEqual({
		id: 1,
		name: "JEAN",
	});

	expect(
		await app.findById({ params: { id: 1 }, headers: { uppercase: true } }),
	).toEqual({
		id: 1,
		name: "JEAN",
	});

	expect(
		await app.findById.fetch(
			{
				params: { id: 1 },
			},
			{
				request: {
					headers: {
						uppercase: "true",
					},
				},
			},
		),
	).toEqual({
		id: 1,
		name: "JEAN",
	});
};

test("$action - headers (app)", async () => {
	await testActionHeader(app);
});

test("$action - headers (api)", async () => {
	await testActionHeader(api);
});

test("$action - headers (remote)", async () => {
	await testActionHeader(apiRemote);
});

test("$action - headers (client-remote)", async () => {
	await testActionHeader(apiClientRemote);
});

test("$action - headers (client-local)", async () => {
	await testActionHeader(apiClientLocal);
});

const testActionErrors = async (app: CrudApi) => {
	await expect(app.findById({ params: { id: 2 } })).rejects.toThrowError(
		"User not found",
	);
	await expect(app.findById.fetch({ params: { id: 2 } })).rejects.toThrowError(
		"User not found",
	);

	// as local function, we go the real error
	await expect(app.internalError()).rejects.toThrowError("Oops");
	// as remove function, we go the http error wrapper
	await expect(app.internalError.fetch()).rejects.toThrowError("Oops");
	// but message is always the same
};

test("$action - errors (app)", async () => {
	await testActionErrors(app);
});

test("$action - errors (api)", async () => {
	await testActionErrors(api);
});

test("$action - errors (remote)", async () => {
	await testActionErrors(apiRemote);
});

test("$action - errors (client-remote)", async () => {
	await testActionErrors(apiClientRemote);
});

test("$action - errors (client-local)", async () => {
	await testActionErrors(apiClientLocal);
});

// TODO - with security (on/off) + forward

// TODO - body parser (multipart)
