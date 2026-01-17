/**
 * Convenient access to LLM models.
 *
 * Usage:
 *     import { llm } from './llm';
 *
 *     // Simple model access
 *     const model = llm.azure_gpt_4_1_mini;
 *     const model = llm.openai_gpt_4o;
 *     const model = llm.google_gemini_2_5_pro;
 *     const model = llm.bu_latest;
 */

import { BaseChatModel } from './base';

// These will be imported dynamically when needed
// For now, we'll define the types and factory function

/**
 * Factory function to create LLM instances from string names with API keys from environment.
 *
 * @param model_name - String name like 'azure_gpt_4_1_mini', 'openai_gpt_4o', etc.
 * @returns LLM instance with API keys from environment variables
 * @throws {ValueError} If model_name is not recognized
 */
export function getLlmByName(modelName: string): BaseChatModel {
	if (!modelName) {
		throw new Error('Model name cannot be empty');
	}

	// This is a placeholder - actual implementation would require importing the chat classes
	// In a real TypeScript implementation, you would:
	// 1. Import the chat classes dynamically or use a factory pattern
	// 2. Read API keys from process.env
	// 3. Create instances with proper configuration

	throw new Error(
		`getLlmByName is not fully implemented in TypeScript. ` +
			`Please use the specific chat classes directly (e.g., ChatOpenAI, ChatGoogle, etc.)`
	);
}

// Type declarations for model instances (for IDE autocomplete)
// These would be created on-demand via a Proxy or getter pattern

export type ModelInstances = {
	// OpenAI instances
	openai_gpt_4o: BaseChatModel;
	openai_gpt_4o_mini: BaseChatModel;
	openai_gpt_4_1_mini: BaseChatModel;
	openai_o1: BaseChatModel;
	openai_o1_mini: BaseChatModel;
	openai_o1_pro: BaseChatModel;
	openai_o3: BaseChatModel;
	openai_o3_mini: BaseChatModel;
	openai_o3_pro: BaseChatModel;
	openai_o4_mini: BaseChatModel;
	openai_gpt_5: BaseChatModel;
	openai_gpt_5_mini: BaseChatModel;
	openai_gpt_5_nano: BaseChatModel;

	// Azure instances
	azure_gpt_4o: BaseChatModel;
	azure_gpt_4o_mini: BaseChatModel;
	azure_gpt_4_1_mini: BaseChatModel;
	azure_o1: BaseChatModel;
	azure_o1_mini: BaseChatModel;
	azure_o1_pro: BaseChatModel;
	azure_o3: BaseChatModel;
	azure_o3_mini: BaseChatModel;
	azure_o3_pro: BaseChatModel;
	azure_gpt_5: BaseChatModel;
	azure_gpt_5_mini: BaseChatModel;

	// Google instances
	google_gemini_2_0_flash: BaseChatModel;
	google_gemini_2_0_pro: BaseChatModel;
	google_gemini_2_5_pro: BaseChatModel;
	google_gemini_2_5_flash: BaseChatModel;
	google_gemini_2_5_flash_lite: BaseChatModel;

	// Mistral instances
	mistral_large: BaseChatModel;
	mistral_medium: BaseChatModel;
	mistral_small: BaseChatModel;
	codestral: BaseChatModel;
	pixtral_large: BaseChatModel;

	// Cerebras instances
	cerebras_llama3_1_8b: BaseChatModel;
	cerebras_llama3_3_70b: BaseChatModel;
	cerebras_gpt_oss_120b: BaseChatModel;
	cerebras_llama_4_scout_17b_16e_instruct: BaseChatModel;
	cerebras_llama_4_maverick_17b_128e_instruct: BaseChatModel;
	cerebras_qwen_3_32b: BaseChatModel;
	cerebras_qwen_3_235b_a22b_instruct_2507: BaseChatModel;
	cerebras_qwen_3_235b_a22b_thinking_2507: BaseChatModel;
	cerebras_qwen_3_coder_480b: BaseChatModel;

	// Browser Use instances
	bu_latest: BaseChatModel;
	bu_1_0: BaseChatModel;
};
