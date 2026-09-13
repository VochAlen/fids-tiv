// src/lib/env.ts
type EnvironmentMode = "live_mode" | "test_mode";

export function getEnvironment(): EnvironmentMode | undefined {
  const env = process.env.DODO_PAYMENTS_ENVIRONMENT;
  
  if (env === "live_mode" || env === "test_mode") {
    return env;
  }
  
  return undefined;
}

export function getRequiredEnvironment(): EnvironmentMode {
  const env = getEnvironment();
  
  if (!env) {
    throw new Error("DODO_PAYMENTS_ENVIRONMENT must be set to 'live_mode' or 'test_mode'");
  }
  
  return env;
}

export function getRequiredApiKey(): string {
  const apiKey = process.env.DODO_PAYMENTS_API_KEY;
  
  if (!apiKey) {
    throw new Error("DODO_PAYMENTS_API_KEY environment variable is required");
  }
  
  return apiKey;
}

export function getRequiredWebhookKey(): string {
  const webhookKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  
  if (!webhookKey) {
    throw new Error("DODO_PAYMENTS_WEBHOOK_KEY environment variable is required");
  }
  
  return webhookKey;
}
// src/lib/env.ts
export function getEnvVariable(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}