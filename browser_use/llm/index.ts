/**
 * We have switched all of our code from langchain to openai.types.chat.chat_completion_message_param.
 * For easier transition we have
 */

// Lightweight imports that are commonly used
export { BaseChatModel, BaseModel, BaseModelConstructor } from './base';
export {
	AssistantMessage,
	BaseMessage,
	SystemMessage,
	UserMessage,
	ContentPartImageParam,
	ContentPartRefusalParam,
	ContentPartTextParam,
	Function,
	ToolCall,
	ImageURL,
	SupportedImageMediaType,
	getUserMessageText,
	getSystemMessageText,
	getAssistantMessageText,
} from './messages';

// Re-export with better names for easier transition
export { ContentPartImageParam as ContentImage } from './messages';
export { ContentPartRefusalParam as ContentRefusal } from './messages';
export { ContentPartTextParam as ContentText } from './messages';

// Export views and exceptions
export { ChatInvokeCompletion, ChatInvokeUsage } from './views';
export { ModelError, ModelProviderError, ModelRateLimitError } from './exceptions';

// Export schema optimizer
export { SchemaOptimizer } from './schema';

// Export models factory
export { getLlmByName } from './models';

// Chat models will be imported on-demand
// In TypeScript, you would typically use dynamic imports or a factory pattern
// For now, we export types that indicate these are available

// Type declarations for lazy-loaded chat models
// These would be imported dynamically when accessed

export type ChatModelClasses = {
	ChatAnthropic: any;
	ChatAnthropicBedrock: any;
	ChatAWSBedrock: any;
	ChatAzureOpenAI: any;
	ChatBrowserUse: any;
	ChatCerebras: any;
	ChatDeepSeek: any;
	ChatGoogle: any;
	ChatGroq: any;
	ChatMistral: any;
	ChatOCIRaw: any;
	ChatOllama: any;
	ChatOpenAI: any;
	ChatOpenRouter: any;
	ChatVercel: any;
};

// Note: In a real TypeScript implementation, you would use:
// 1. Dynamic imports for heavy dependencies
// 2. A Proxy object for lazy loading
// 3. Or explicit exports with conditional loading

// For now, users should import chat classes directly:
// import { ChatOpenAI } from './llm/openai/chat';
// import { ChatGoogle } from './llm/google/chat';
// etc.
