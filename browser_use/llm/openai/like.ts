/**
 * ChatOpenAILike - A class to interact with any provider using the OpenAI API schema.
 */

import { ChatOpenAI, ChatOpenAIConfig } from './chat';

export interface ChatOpenAILikeConfig extends ChatOpenAIConfig {
	model: string;
}

export class ChatOpenAILike extends ChatOpenAI {
	/**
	 * A class for to interact with any provider using the OpenAI API schema.
	 *
	 * @param model - The name of the OpenAI model to use.
	 */
	constructor(config: ChatOpenAILikeConfig) {
		super(config);
	}
}
