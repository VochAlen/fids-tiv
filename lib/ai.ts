// src/lib/ai.ts
import { getEnvVariable } from './env';

// Define supported AI model providers
export type AIModelProvider = 'openrouter' | 'anthropic' | 'openai' | 'gemini' | 'deepseek';

// Define AI message structure
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Define AI request structure
export interface AIRequest {
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
  provider?: AIModelProvider;
  model?: string;
  stream?: boolean;
}

// Define AI response structure
export interface AIResponse {
  role: 'assistant';
  content: string;
}

// Define provider configuration
interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
}

// Centralized provider configurations
const PROVIDER_CONFIG: Record<AIModelProvider, ProviderConfig> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: getEnvVariable('OPENAI_API_KEY'),
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: getEnvVariable('ANTHROPIC_API_KEY'),
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: getEnvVariable('GEMINI_API_KEY'),
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: getEnvVariable('OPENROUTER_API_KEY'),
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: getEnvVariable('DEEPSEEK_API_KEY'),
  },
};

// Default models for each provider
const DEFAULT_MODELS: Record<AIModelProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20240620',
  gemini: 'gemini-1.5-pro',
  openrouter: 'openai/gpt-4o-mini',
  deepseek: 'deepseek-chat',
};

// Define expected response shapes for different providers
interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
}

interface AnthropicResponse {
  content: Array<{ text: string }>;
}

interface GeminiResponse {
  candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
}

type AIProviderResponse = OpenAIResponse | AnthropicResponse | GeminiResponse;

export async function callAI(req: AIRequest): Promise<AIResponse> {
  const provider: AIModelProvider = req.provider ?? 'deepseek';
  const { baseUrl, apiKey } = PROVIDER_CONFIG[provider];

  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  const model = req.model ?? DEFAULT_MODELS[provider];

  // Construct request body
  const body =
    provider === 'anthropic'
      ? {
          model,
          max_tokens: req.maxTokens ?? 800,
          temperature: req.temperature ?? 0.7,
          messages: req.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        }
      : {
          model,
          max_tokens: req.maxTokens ?? 800,
          temperature: req.temperature ?? 0.7,
          messages: req.messages,
          stream: req.stream ?? false,
        };

  // Construct headers as Record<string, string> to match HeadersInit
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (provider !== 'gemini') {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://your-app.com';
    headers['X-Title'] = 'Your App Name';
  }

  // Construct URL
  const url =
    provider === 'gemini'
      ? `${baseUrl}/models/${model}:generateContent?key=${apiKey}`
      : `${baseUrl}/chat/completions`;

  // Make API request
  const response = await fetch(url, {
    method: 'POST',
    headers, // Now headers is guaranteed to be Record<string, string>
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error (${provider}, ${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as AIProviderResponse;

  // Extract content based on provider response format
  let content: string;

  if (provider === 'anthropic') {
    content = (data as AnthropicResponse).content?.[0]?.text;
  } else if (provider === 'gemini') {
    content = (data as GeminiResponse).candidates?.[0]?.content?.parts?.[0]?.text;
  } else {
    content = (data as OpenAIResponse).choices?.[0]?.message?.content;
  }

  if (!content) {
    throw new Error(`Empty response from ${provider}`);
  }

  return { role: 'assistant', content };
}