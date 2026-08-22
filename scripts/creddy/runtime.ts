import { CREDDY_CAMPAIGN_SLUG } from './config.js';

export type CreddyAiExecutionMode = 'codex_scheduled' | 'openai_api';

export interface CreddyRuntimeConfig {
  enabled: boolean;
  campaignSlug: string;
  aiExecutionMode: CreddyAiExecutionMode;
  firecrawlApiKey: string;
  openaiApiKey: string;
  socialSupabaseUrl: string;
  socialSupabaseAnonKey: string;
  socialSupabaseServiceRoleKey: string;
  creddySupabaseUrl: string;
  creddySupabaseAnonKey: string;
  videoFactoryBaseUrl: string;
}

function value(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? '';
}

function enabled(valueToParse: string): boolean {
  return valueToParse.toLocaleLowerCase('en-US') === 'true';
}

function aiExecutionMode(env: NodeJS.ProcessEnv): CreddyAiExecutionMode {
  const configured = value(env, 'CREDDY_AI_EXECUTION_MODE') || 'codex_scheduled';
  if (configured !== 'codex_scheduled' && configured !== 'openai_api') {
    throw new Error(
      'CREDDY_AI_EXECUTION_MODE must be codex_scheduled or openai_api',
    );
  }
  return configured;
}

/**
 * Reads only Creddy-specific runtime settings.
 *
 * The default is OFF. Existing `main.ts` and scheduled jobs do not import this
 * module, so adding the feature cannot change their behavior accidentally.
 */
export function getCreddyRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): CreddyRuntimeConfig {
  const config: CreddyRuntimeConfig = {
    enabled: enabled(value(env, 'CREDDY_PIPELINE_ENABLED')),
    campaignSlug: value(env, 'CREDDY_CAMPAIGN_SLUG') || CREDDY_CAMPAIGN_SLUG,
    aiExecutionMode: aiExecutionMode(env),
    firecrawlApiKey: value(env, 'FIRECRAWL_API_KEY'),
    openaiApiKey: value(env, 'OPENAI_API_KEY'),
    socialSupabaseUrl: value(env, 'NEXT_PUBLIC_SUPABASE_URL'),
    socialSupabaseAnonKey: value(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    socialSupabaseServiceRoleKey: value(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    creddySupabaseUrl: value(env, 'CREDDY_SUPABASE_URL'),
    creddySupabaseAnonKey: value(env, 'CREDDY_SUPABASE_ANON_KEY'),
    videoFactoryBaseUrl:
      value(env, 'VIDEO_FACTORY_BASE_URL') || 'http://127.0.0.1:4300',
  };

  if (!config.enabled) return config;

  const missing = [
    ['FIRECRAWL_API_KEY', config.firecrawlApiKey],
  ].filter(([, configuredValue]) => !configuredValue);

  if (config.aiExecutionMode === 'openai_api' && !config.openaiApiKey) {
    missing.push(['OPENAI_API_KEY', config.openaiApiKey]);
  }

  if (missing.length > 0) {
    throw new Error(
      `Creddy pipeline is enabled but required variables are missing: ${missing
        .map(([name]) => name)
        .join(', ')}`,
    );
  }

  return config;
}
