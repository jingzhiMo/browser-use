/**
 * View types for chat model invocations
 */

/**
 * Usage information for a chat model invocation.
 */
export type ChatInvokeUsage = {
	prompt_tokens: number;
	/**The number of tokens in the prompt (this includes the cached tokens as well. When calculating the cost, subtract the cached tokens from the prompt tokens)*/
	prompt_cached_tokens?: number | null;
	/**The number of cached tokens.*/
	prompt_cache_creation_tokens?: number | null;
	/**Anthropic only: The number of tokens used to create the cache.*/
	prompt_image_tokens?: number | null;
	/**Google only: The number of tokens in the image (prompt tokens is the text tokens + image tokens in that case)*/
	completion_tokens: number;
	/**The number of tokens in the completion.*/
	total_tokens: number;
	/**The total number of tokens in the response.*/
};

/**
 * Response from a chat model invocation.
 */
export type ChatInvokeCompletion<T> = {
	completion: T;
	/**The completion of the response.*/
	thinking?: string | null;
	redacted_thinking?: string | null;
	usage: ChatInvokeUsage | null;
	/**The usage of the response.*/
	stop_reason?: string | null;
	/**The reason the model stopped generating. Common values: 'end_turn', 'max_tokens', 'stop_sequence'.*/
};
