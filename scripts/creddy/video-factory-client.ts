export interface VideoFactoryCapabilities {
  version: string;
  capabilities?: {
    audio_modes?: string[];
    external_id?: boolean;
    styles?: string[];
    creddy_themes?: string[];
    voices?: string[];
  };
}

export interface VideoFactoryRemoteJob {
  id: string;
  external_id?: string;
  status: string;
  output?: string;
  error?: string;
}

export interface SubmitVideoFactoryJob {
  external_id: string;
  campaign_slug: string;
  title: string;
  script: string[];
  keyword: string;
  format: '9:16';
  audio_mode: 'narrated' | 'text_music';
  music_path?: string;
  background_path?: string;
  character_expressions?: string[];
  voice: 'cloned';
  style: 'creddy';
  theme: 'editorial' | 'midnight' | 'ledger' | 'poster' | 'aurora';
}

export interface VideoFactoryApi {
  getCapabilities(): Promise<VideoFactoryCapabilities>;
  listJobs(): Promise<VideoFactoryRemoteJob[]>;
  submitJob(job: SubmitVideoFactoryJob): Promise<VideoFactoryRemoteJob>;
}

export class VideoFactoryClient implements VideoFactoryApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    const parsed = new URL(this.baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Video Factory URL must use HTTP(S)');
    }
  }

  async getCapabilities(): Promise<VideoFactoryCapabilities> {
    return this.request<VideoFactoryCapabilities>('/api/version');
  }

  async listJobs(): Promise<VideoFactoryRemoteJob[]> {
    return this.request<VideoFactoryRemoteJob[]>('/api/jobs');
  }

  async submitJob(job: SubmitVideoFactoryJob): Promise<VideoFactoryRemoteJob> {
    return this.request<VideoFactoryRemoteJob>('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Video Factory ${path} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as T;
  }
}
