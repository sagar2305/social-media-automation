import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

export interface BlotatoScheduleInput {
  platform: 'instagram' | 'tiktok';
  account: string;
  caption: string;
  title: string;
  videoPath: string;
  scheduledFor: string;
}

export interface BlotatoScheduleResult {
  submissionId: string;
  mediaUrl: string;
}

export interface BlotatoPostStatus {
  status: 'in-progress' | 'queued' | 'scheduled' | 'published' | 'failed';
  url?: string;
  error?: string;
}

export interface BlotatoApi {
  scheduleVideo(input: BlotatoScheduleInput): Promise<BlotatoScheduleResult>;
  getPostStatus(submissionId: string): Promise<BlotatoPostStatus>;
}

interface BlotatoAccount {
  id?: string;
  accountId?: string;
  username?: string;
  fullname?: string;
  platform?: string;
}

export class BlotatoClient implements BlotatoApi {
  private readonly baseUrl = 'https://backend.blotato.com/v2';
  private readonly maxBase64VideoBytes = 12_000_000;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) throw new Error('BLOTATO_API_KEY is required');
  }

  async scheduleVideo(input: BlotatoScheduleInput): Promise<BlotatoScheduleResult> {
    const accounts = await this.request<{ items?: BlotatoAccount[] } | BlotatoAccount[]>(
      `/users/me/accounts?platform=${input.platform}`,
    );
    const items = Array.isArray(accounts) ? accounts : accounts.items ?? [];
    const normalized = input.account.replace(/^@/, '').toLocaleLowerCase('en-US');
    const account = items.find((candidate) =>
      [candidate.username, candidate.fullname, candidate.id, candidate.accountId]
        .filter(Boolean)
        .some((value) => String(value).replace(/^@/, '').toLocaleLowerCase('en-US') === normalized),
    );
    const accountId = account?.accountId ?? account?.id;
    if (!accountId) throw new Error(`Blotato account not found: ${input.platform}/${input.account}`);

    const extension = extname(input.videoPath).toLocaleLowerCase('en-US');
    const mime = extension === '.mov' ? 'video/quicktime' : 'video/mp4';
    const file = await stat(input.videoPath);
    if (file.size > this.maxBase64VideoBytes) {
      throw new Error(
        `Video is ${file.size} bytes; local Blotato uploads are limited to ${this.maxBase64VideoBytes}. ` +
        'Host the video at an approved public URL or reduce the render size before scheduling.',
      );
    }
    const data = await readFile(input.videoPath);
    const uploaded = await this.request<{ url: string }>('/media', {
      method: 'POST',
      body: JSON.stringify({ url: `data:${mime};base64,${data.toString('base64')}` }),
    });
    if (!uploaded.url) throw new Error('Blotato media upload returned no URL');

    const target: Record<string, unknown> = {
      targetType: input.platform,
      isAiGenerated: true,
    };
    if (input.platform === 'tiktok') {
      Object.assign(target, {
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: true,
        isDraft: false,
        title: input.title.slice(0, 90),
      });
    }
    const created = await this.request<{ postSubmissionId: string }>('/posts', {
      method: 'POST',
      body: JSON.stringify({
        post: {
          accountId,
          content: {
            text: input.caption,
            mediaUrls: [uploaded.url],
            platform: input.platform,
          },
          target,
        },
        scheduledTime: input.scheduledFor,
      }),
    });
    if (!created.postSubmissionId) throw new Error('Blotato returned no postSubmissionId');
    return { submissionId: created.postSubmissionId, mediaUrl: uploaded.url };
  }

  async getPostStatus(submissionId: string): Promise<BlotatoPostStatus> {
    const result = await this.request<{
      status: BlotatoPostStatus['status'];
      errorMessage?: string;
      result?: { url?: string };
    }>(`/posts/${encodeURIComponent(submissionId)}`);
    return { status: result.status, url: result.result?.url, error: result.errorMessage };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'blotato-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(60_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `Blotato ${path} failed with HTTP ${response.status}: ${raw.replaceAll(this.apiKey, '[redacted]').slice(0, 300)}`,
      );
    }
    return JSON.parse(raw) as T;
  }
}
