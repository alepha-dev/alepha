import type { Static, TObject, TProperties, TSchema } from "@alepha/core";
import { $inject, Alepha, TypeGuard } from "@alepha/core";
import type { Type } from "protobufjs";
import protobufjs from "protobufjs";

export class ProtobufProvider {
	protected readonly alepha: Alepha = $inject(Alepha);
	protected readonly schemas: Map<string | TObject<TProperties>, Type> =
		new Map();
	protected readonly protobuf: typeof protobufjs = protobufjs;

	/**
	 * Encode an object to a Uint8Array.
	 *
	 * @param schema - TypeBox schema used to generate the Protobuf schema.
	 * @param data - Object to encode. Can be any object or string.
	 */
	public encode(schema: TObject, data: any): Uint8Array {
		return this.parse(schema).encode(this.alepha.parse(schema, data)).finish();
	}

	/**
	 * Decode a Uint8Array to an object.
	 *
	 * @param schema
	 * @param data
	 */
	public decode<T extends TObject>(schema: T, data: Uint8Array): Static<T> {
		return this.alepha.parse(schema, this.parse(schema).decode(data));
	}

	/**
	 * Parse a TypeBox schema to a Protobuf Type schema ready for encoding/decoding.
	 *
	 * @param schema
	 * @param typeName
	 */
	public parse(
		schema: ProtobufSchema | TObject,
		typeName = "root.Target",
	): Type {
		const exists = this.schemas.get(schema);
		if (exists) return exists;

		const pbSchema =
			typeof schema === "string" ? schema : this.createProtobufSchema(schema);
		const result = this.protobuf.parse(pbSchema);
		const type = result.root.lookupType(typeName);
		this.schemas.set(schema, type);
		return type;
	}

	/**
	 * Convert a TypeBox schema to a Protobuf schema as a string.
	 *
	 * @param schema
	 * @param options
	 */
	public createProtobufSchema(
		schema: TSchema,
		options: CreateProtobufSchemaOptions = {},
	): string {
		const { rootName = "root", mainMessageName = "Target" } = options;
		const context = {
			proto: `package ${rootName};\nsyntax = "proto3";\n\n`,
			fieldIndex: 1,
		};

		if (TypeGuard.IsObject(schema)) {
			const proto = this.parseObject(schema, mainMessageName, context);
			context.proto += proto;
		}

		return context.proto;
	}

	/**
	 * Parse an object schema to a Protobuf message.
	 *
	 * @param obj
	 * @param parentName
	 * @param context
	 * @protected
	 */
	protected parseObject(
		obj: TSchema,
		parentName: string,
		context: { proto: string; fieldIndex: number },
	): string {
		if (!TypeGuard.IsObject(obj)) {
			return "";
		}

		const fields: string[] = [];

		for (const [key, value] of Object.entries(obj.properties)) {
			if (TypeGuard.IsArray(value)) {
				if (TypeGuard.IsObject(value.items)) {
					const subMessageName = value.items.title ?? `${parentName}_${key}`;
					context.proto += this.parseObject(value.items, subMessageName, {
						...context,
						fieldIndex: 1,
					});
					fields.push(
						`  repeated ${subMessageName} ${key} = ${context.fieldIndex++};`,
					);
					continue;
				}

				const itemType = this.convertType(value.items);
				fields.push(`  repeated ${itemType} ${key} = ${context.fieldIndex++};`);
				continue;
			}

			if (TypeGuard.IsObject(value)) {
				const subMessageName = `${parentName}_${key}`;
				context.proto += this.parseObject(value, subMessageName, context);
				fields.push(`  ${subMessageName} ${key} = ${context.fieldIndex++};`);
				continue;
			}

			fields.push(
				`  ${this.convertType(value)} ${key} = ${context.fieldIndex++};`,
			);
		}

		return `message ${parentName} {\n${fields.join("\n")}\n}\n`;
	}

	/**
	 * Convert a primitive TypeBox schema type to a Protobuf spec type.
	 *
	 * @param schema
	 * @protected
	 */
	protected convertType(schema: TSchema): string {
		if (TypeGuard.IsInteger(schema)) return "int32";
		if (TypeGuard.IsNumber(schema)) return "double";
		if (TypeGuard.IsString(schema)) return "string";
		if (TypeGuard.IsBoolean(schema)) return "bool";

		throw new Error(`Unsupported type: ${JSON.stringify(schema)}`);
	}
}

export type ProtobufSchema = string;

export interface CreateProtobufSchemaOptions {
	rootName?: string;
	mainMessageName?: string;
}
