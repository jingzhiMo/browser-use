/**
 * Utilities for creating optimized Pydantic schemas for LLM usage.
 */

import type { BaseModel, BaseModelConstructor } from './base';

export class SchemaOptimizer {
	/**
	 * Create the most optimized schema by flattening all $ref/$defs while preserving
	 * FULL descriptions and ALL action definitions. Also ensures OpenAI strict mode compatibility.
	 *
	 * @param model - The Pydantic model to optimize
	 * @param remove_min_items - If true, remove minItems from the schema
	 * @param remove_defaults - If true, remove default values from the schema
	 * @returns Optimized schema with all $refs resolved and strict mode compatibility
	 */
	static createOptimizedJsonSchema(
		model: BaseModelConstructor<BaseModel>,
		options: {
			remove_min_items?: boolean;
			remove_defaults?: boolean;
		} = {}
	): Record<string, any> {
		const { remove_min_items = false, remove_defaults = false } = options;

		// Create an instance to get the schema
		const modelInstance = new model();
		const originalSchema = modelInstance.model_json_schema();

		// Extract $defs for reference resolution, then flatten everything
		const defsLookup = (originalSchema.$defs as Record<string, any>) || {};

		// Create optimized schema with flattening
		const optimizeSchema = (
			obj: any,
			defsLookup: Record<string, any> | null = null,
			inProperties: boolean = false
		): any => {
			/**Apply all optimization techniques including flattening all $ref/$defs*/
			if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
				const optimized: Record<string, any> = {};
				let flattenedRef: Record<string, any> | null = null;

				// Skip unnecessary fields AND $defs (we'll inline everything)
				const skipFields = ['additionalProperties', '$defs'];

				for (const [key, value] of Object.entries(obj)) {
					if (skipFields.includes(key)) {
						continue;
					}

					// Skip metadata "title" unless we're iterating inside an actual `properties` map
					if (key === 'title' && !inProperties) {
						continue;
					}
					// Preserve FULL descriptions without truncation, skip empty ones
					else if (key === 'description') {
						if (value) {
							// Only include non-empty descriptions
							optimized[key] = value;
						}
					}
					// Handle type field - must recursively process in case value contains $ref
					else if (key === 'type') {
						optimized[key] =
							typeof value === 'object' || Array.isArray(value)
								? optimizeSchema(value, defsLookup, inProperties)
								: value;
					}
					// FLATTEN: Resolve $ref by inlining the actual definition
					else if (key === '$ref' && defsLookup) {
						const refPath = (value as string).split('/').pop() || ''; // Get the definition name from "#/$defs/SomeName"
						if (refPath in defsLookup) {
							// Get the referenced definition and flatten it
							const referencedDef = defsLookup[refPath];
							flattenedRef = optimizeSchema(referencedDef, defsLookup, inProperties);
						}
					}
					// Skip minItems/min_items and default if requested (check BEFORE processing)
					else if ((key === 'minItems' || key === 'min_items') && remove_min_items) {
						continue; // Skip minItems/min_items
					} else if (key === 'default' && remove_defaults) {
						continue; // Skip default values
					}
					// Keep all anyOf structures (action unions) and resolve any $refs within
					else if (key === 'anyOf' && Array.isArray(value)) {
						optimized[key] = value.map((item) => optimizeSchema(item, defsLookup, inProperties));
					}
					// Recursively optimize nested structures
					else if (key === 'properties' || key === 'items') {
						optimized[key] = optimizeSchema(
							value,
							defsLookup,
							key === 'properties' // in_properties
						);
					}
					// Keep essential validation fields
					else if (
						[
							'type',
							'required',
							'minimum',
							'maximum',
							'minItems',
							'min_items',
							'maxItems',
							'pattern',
							'default',
						].includes(key)
					) {
						optimized[key] =
							typeof value === 'object' || Array.isArray(value)
								? optimizeSchema(value, defsLookup, inProperties)
								: value;
					}
					// Recursively process all other fields
					else {
						optimized[key] =
							typeof value === 'object' || Array.isArray(value)
								? optimizeSchema(value, defsLookup, inProperties)
								: value;
					}
				}

				// If we have a flattened reference, merge it with the optimized properties
				if (flattenedRef !== null && typeof flattenedRef === 'object' && !Array.isArray(flattenedRef)) {
					// Start with the flattened reference as the base
					const result = { ...flattenedRef };

					// Merge in any sibling properties that were processed
					for (const [key, value] of Object.entries(optimized)) {
						// Preserve descriptions from the original object if they exist
						if (key === 'description' && !('description' in result)) {
							result[key] = value;
						} else if (key !== 'description') {
							// Don't overwrite description from flattened ref
							result[key] = value;
						}
					}

					return result;
				} else {
					// No $ref, just return the optimized object
					// CRITICAL: Add additionalProperties: false to ALL objects for OpenAI strict mode
					if (optimized.type === 'object') {
						optimized.additionalProperties = false;
					}

					return optimized;
				}
			} else if (Array.isArray(obj)) {
				return obj.map((item) => optimizeSchema(item, defsLookup, inProperties));
			}
			return obj;
		};

		let optimizedResult = optimizeSchema(originalSchema, defsLookup);

		// Ensure we have a dictionary (should always be the case for schema root)
		if (typeof optimizedResult !== 'object' || optimizedResult === null || Array.isArray(optimizedResult)) {
			throw new Error('Optimized schema result is not a dictionary');
		}

		const optimizedSchema: Record<string, any> = optimizedResult;

		// Additional pass to ensure ALL objects have additionalProperties: false
		const ensureAdditionalPropertiesFalse = (obj: any): void => {
			/**Ensure all objects have additionalProperties: false*/
			if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
				// If it's an object type, ensure additionalProperties is false
				if (obj.type === 'object') {
					obj.additionalProperties = false;
				}

				// Recursively apply to all values
				for (const value of Object.values(obj)) {
					if (typeof value === 'object' || Array.isArray(value)) {
						ensureAdditionalPropertiesFalse(value);
					}
				}
			} else if (Array.isArray(obj)) {
				for (const item of obj) {
					if (typeof item === 'object' || Array.isArray(item)) {
						ensureAdditionalPropertiesFalse(item);
					}
				}
			}
		};

		ensureAdditionalPropertiesFalse(optimizedSchema);
		SchemaOptimizer._makeStrictCompatible(optimizedSchema);

		// Final pass to remove minItems/min_items and default values if requested
		if (remove_min_items || remove_defaults) {
			const removeForbiddenFields = (obj: any): void => {
				/**Recursively remove minItems/min_items and default values*/
				if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
					// Remove forbidden keys
					if (remove_min_items) {
						delete obj.minItems;
						delete obj.min_items;
					}
					if (remove_defaults) {
						delete obj.default;
					}
					// Recursively process all values
					for (const value of Object.values(obj)) {
						if (typeof value === 'object' || Array.isArray(value)) {
							removeForbiddenFields(value);
						}
					}
				} else if (Array.isArray(obj)) {
					for (const item of obj) {
						if (typeof item === 'object' || Array.isArray(item)) {
							removeForbiddenFields(item);
						}
					}
				}
			};

			removeForbiddenFields(optimizedSchema);
		}

		return optimizedSchema;
	}

	/**
	 * Ensure all properties are required for OpenAI strict mode
	 */
	private static _makeStrictCompatible(schema: Record<string, any> | any[]): void {
		if (Array.isArray(schema)) {
			for (const item of schema) {
				if (typeof item === 'object' || Array.isArray(item)) {
					SchemaOptimizer._makeStrictCompatible(item);
				}
			}
		} else if (typeof schema === 'object' && schema !== null) {
			// First recursively apply to nested objects
			for (const [key, value] of Object.entries(schema)) {
				if ((typeof value === 'object' || Array.isArray(value)) && key !== 'required') {
					SchemaOptimizer._makeStrictCompatible(value);
				}
			}

			// Then update required for this level
			if ('properties' in schema && 'type' in schema && schema.type === 'object') {
				// Add all properties to required array
				const allProps = Object.keys(schema.properties);
				schema.required = allProps; // Set all properties as required
			}
		}
	}

	/**
	 * Create Gemini-optimized schema, preserving explicit `required` arrays so Gemini
	 * respects mandatory fields defined by the caller.
	 *
	 * @param model - The Pydantic model to optimize
	 * @returns Optimized schema suitable for Gemini structured output
	 */
	static createGeminiOptimizedSchema(model: BaseModelConstructor<BaseModel>): Record<string, any> {
		return SchemaOptimizer.createOptimizedJsonSchema(model);
	}
}
