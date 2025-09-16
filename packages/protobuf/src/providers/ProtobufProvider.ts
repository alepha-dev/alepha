import type { Static, TObject, TProperties, TSchema } from "@alepha/core";
import { $inject, Alepha, PRIMITIVE, TypeGuard } from "@alepha/core";
import type { Type } from "protobufjs";
import protobufjs from "protobufjs";

export class ProtobufProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly schemas: Map<string | TObject<TProperties>, Type> =
		new Map();
	protected readonly protobuf: typeof protobufjs = protobufjs;

	/**
	 * Encode an object to a Uint8Array.
	 */
	public encode(schema: TObject, data: any): Uint8Array {
		return this.parse(schema).encode(this.alepha.parse(schema, data)).finish();
	}

	/**
	 * Decode a Uint8Array to an object.
	 */
	public decode<T extends TObject>(schema: T, data: Uint8Array): Static<T> {
		return this.alepha.parse(schema, this.parse(schema).decode(data));
	}

	/**
	 * Parse a TypeBox schema to a Protobuf Type schema ready for encoding/decoding.
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
			const { message, subMessages } = this.parseObjectWithDependencies(
				schema,
				mainMessageName,
			);
			// Add all sub-messages first
			context.proto += subMessages.join("");
			// Then add the main message
			context.proto += message;
		}

		return context.proto;
	}

	/**
	 * Parse an object schema with dependencies (sub-messages).
	 */
	protected parseObjectWithDependencies(
		obj: TSchema,
		parentName: string,
	): { message: string; subMessages: string[] } {
		if (!TypeGuard.IsObject(obj)) {
			return { message: "", subMessages: [] };
		}

		const fields: string[] = [];
		const subMessages: string[] = [];
		let fieldIndex = 1;

		for (const [key, value] of Object.entries(obj.properties)) {
			// Handle arrays
			if (TypeGuard.IsArray(value)) {
				if (TypeGuard.IsObject(value.items)) {
					const subMessageName = value.items.title ?? `${parentName}_${key}`;
					const { message: subMessage, subMessages: nestedSubMessages } =
						this.parseObjectWithDependencies(value.items, subMessageName);
					subMessages.push(...nestedSubMessages);
					subMessages.push(subMessage);
					fields.push(`  repeated ${subMessageName} ${key} = ${fieldIndex++};`);
					continue;
				}

				const itemType = this.convertType(value.items);
				fields.push(`  repeated ${itemType} ${key} = ${fieldIndex++};`);
				continue;
			}

			// Handle nested objects
			if (TypeGuard.IsObject(value)) {
				const subMessageName = value.title ?? `${parentName}_${key}`;
				const { message: subMessage, subMessages: nestedSubMessages } =
					this.parseObjectWithDependencies(value, subMessageName);
				subMessages.push(...nestedSubMessages);
				subMessages.push(subMessage);
				fields.push(`  ${subMessageName} ${key} = ${fieldIndex++};`);
				continue;
			}

			// Handle union types (nullable fields)
			if (TypeGuard.IsUnion(value)) {
				const nonNullType = value.anyOf.find(
					(type: TSchema) => !TypeGuard.IsNull(type),
				);
				if (nonNullType) {
					if (TypeGuard.IsObject(nonNullType)) {
						const subMessageName = nonNullType.title ?? `${parentName}_${key}`;
						const { message: subMessage, subMessages: nestedSubMessages } =
							this.parseObjectWithDependencies(nonNullType, subMessageName);
						subMessages.push(...nestedSubMessages);
						subMessages.push(subMessage);
						fields.push(`  ${subMessageName} ${key} = ${fieldIndex++};`);
						continue;
					}
					const fieldType = this.convertType(nonNullType);
					fields.push(`  ${fieldType} ${key} = ${fieldIndex++};`);
					continue;
				}
			}

			// Handle records (maps)
			if (TypeGuard.IsRecord(value)) {
				// TypeBox records use additionalProperties or patternProperties for the value type
				let valueSchema: TSchema | undefined;
				if (
					value.additionalProperties &&
					typeof value.additionalProperties === "object"
				) {
					valueSchema = value.additionalProperties;
				} else if (
					value.patternProperties &&
					typeof value.patternProperties === "object"
				) {
					// Get the first pattern property (usually "^(.*)$" or similar)
					const patterns = Object.values(value.patternProperties);
					if (patterns.length > 0 && typeof patterns[0] === "object") {
						valueSchema = patterns[0] as TSchema;
					}
				}

				if (valueSchema) {
					const valueType = this.convertType(valueSchema);
					fields.push(`  map<string, ${valueType}> ${key} = ${fieldIndex++};`);
					continue;
				}
			}

			// Handle regular fields
			const fieldType = this.convertType(value);
			fields.push(`  ${fieldType} ${key} = ${fieldIndex++};`);
		}

		const message = `message ${parentName} {\n${fields.join("\n")}\n}\n`;
		return { message, subMessages };
	}

	/**
	 * Convert a primitive TypeBox schema type to a Protobuf spec type.
	 */
	protected convertType(schema: TSchema): string {
		// Handle primitives by PRIMITIVE symbol (for enhanced TypeProvider types)
		if (schema && typeof schema === "object" && PRIMITIVE in schema) {
			const primitive = schema[PRIMITIVE];
			switch (primitive) {
				case "string":
					return "string";
				case "bool":
					return "bool";
				case "float":
					return "double";
				case "uchar":
					return "uint32"; // Proto3 doesn't have uint8, use uint32
				case "uint32":
					return "uint32";
				case "int32":
					return "int32";
				case "bigint":
					return "int64";
				default:
					// For custom primitives like date-time, uuid, etc., treat as string
					return "string";
			}
		}

		// Handle union types (nullable)
		if (TypeGuard.IsUnion(schema)) {
			// Find the non-null type in the union
			const nonNullType = schema.anyOf.find(
				(type: TSchema) => !TypeGuard.IsNull(type),
			);
			if (nonNullType) {
				return this.convertType(nonNullType);
			}
		}

		// Handle optional types
		if (TypeGuard.IsOptional(schema)) {
			return this.convertType(schema);
		}

		// Handle unsafe types (like enums)
		if (TypeGuard.IsUnsafe(schema)) {
			// Check if it's an enum
			if (schema.enum) {
				return "string"; // Proto3 enums are more complex, use string for simplicity
			}
			// Other unsafe types default to string
			return "string";
		}

		// Fallback to TypeGuard checks for basic types
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
