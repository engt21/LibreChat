import { randomUUID } from 'node:crypto';
import { expect, type APIResponse, type Locator, type Page } from '@playwright/test';

export const COMPLETE_GRAFT_BRIDGE_TEXT =
  'An alternate completed assistant generation was grafted into this branch. Treat the following assistant message and any copied continuation as prior conversation context.';

export const PARTIAL_GRAFT_WARNING_TEXT =
  'Partial generations are copied as incomplete prior context.';

type JsonRecord = Record<string, unknown>;
const NO_PARENT_MESSAGE_ID = '00000000-0000-0000-0000-000000000000';

export type GraftingApiMessage = JsonRecord & {
  conversationId?: string;
  messageId: string;
  parentMessageId?: string;
  text?: string;
  metadata?: JsonRecord;
};

export type SeededMessageInput = {
  messageId?: string;
  parentMessageId?: string;
  text: string;
  content?: unknown;
  isCreatedByUser: boolean;
  sender?: string;
  endpoint?: string;
  model?: string;
  unfinished?: boolean;
  error?: boolean;
  finishReason?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export type SeededMessage = SeededMessageInput & {
  messageId: string;
  parentMessageId: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationShell = {
  conversationId: string;
  title: string;
  endpoint: string;
  model: string;
};

type ConversationShellOptions = Partial<ConversationShell> & {
  createdAt?: string;
  updatedAt?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function buildTimestamp(baseTimeMs: number, index: number) {
  return new Date(baseTimeMs + index * 1_000).toISOString();
}

async function getCenter(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();

  if (box == null) {
    throw new Error('Expected a visible element with a bounding box for graft interaction.');
  }

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

export function isGenerationGraftBridgeMessage(message: Partial<GraftingApiMessage>) {
  const metadata = isRecord(message.metadata) ? message.metadata : null;
  const generationGraft =
    metadata && isRecord(metadata.generationGraft) ? metadata.generationGraft : null;
  return generationGraft?.kind === 'generation_graft';
}

export function isGenerationGraftCopyMessage(message: Partial<GraftingApiMessage>) {
  const metadata = isRecord(message.metadata) ? message.metadata : null;
  const generationGraftCopy =
    metadata && isRecord(metadata.generationGraftCopy) ? metadata.generationGraftCopy : null;
  return generationGraftCopy?.kind === 'generation_graft_copy';
}

export async function gotoConversation(page: Page, conversationId: string, expectedText: string) {
  await page.goto(`/c/${conversationId}`);
  await expect(page).toHaveURL(new RegExp(`/c/${conversationId}$`));
  await expect(page.getByText(expectedText, { exact: false })).toBeVisible();
}

export async function openConversationTree(page: Page) {
  const mobileNavMask = page.locator('#mobile-nav-mask-toggle.active');
  if (await mobileNavMask.isVisible()) {
    await mobileNavMask.evaluate((element: HTMLElement) => element.click());
    await expect(mobileNavMask).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'View in conversation tree' }).last().click();
  await expect(page.getByTestId('generation-tree-dialog')).toBeVisible();
}

export async function closeConversationTree(page: Page) {
  await page
    .getByTestId('generation-tree-dialog')
    .getByRole('button', { name: 'Close' })
    .last()
    .click();
  await expect(page.getByTestId('generation-tree-dialog')).toBeHidden();
}

export async function dragGraftHandleToNode(
  page: Page,
  sourceMessageId: string,
  destinationMessageId: string,
  pointerType: 'mouse' | 'touch' = 'mouse',
) {
  const sourceHandle = page.getByTestId(`graft-handle-${sourceMessageId}`);
  const destinationNode = page.getByTestId(`tree-node-${destinationMessageId}`);
  const source = await getCenter(sourceHandle);
  const destination = await getCenter(destinationNode);

  if (pointerType === 'mouse') {
    await page.mouse.move(source.x, source.y);
    await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 18 });
    await page.mouse.up();
    return;
  }

  const body = page.locator('body');
  const pointerDown = {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    buttons: 1,
    clientX: source.x,
    clientY: source.y,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const pointerMove = {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    buttons: 1,
    clientX: destination.x,
    clientY: destination.y,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const pointerUp = {
    ...pointerMove,
    buttons: 0,
  };

  await sourceHandle.dispatchEvent('pointerdown', pointerDown);
  await body.dispatchEvent('pointermove', {
    ...pointerMove,
    clientX: (source.x + destination.x) / 2,
    clientY: (source.y + destination.y) / 2,
  });
  await body.dispatchEvent('pointermove', pointerMove);
  await body.dispatchEvent('pointerup', pointerUp);
}

export class GenerationTreeGraftingApi {
  private readonly trackedConversationIds = new Set<string>();
  private accessToken: string | null = null;

  constructor(private readonly page: Page) {}

  private async readJson<T>(response: APIResponse): Promise<T> {
    return (await response.json()) as T;
  }

  private async readError(response: APIResponse) {
    try {
      return await response.text();
    } catch (error) {
      return `Unable to read response body: ${String(error)}`;
    }
  }

  private async apiFetch(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    data?: unknown,
  ): Promise<APIResponse> {
    const doFetch = async () =>
      this.page.request.fetch(path, {
        method,
        data,
        failOnStatusCode: false,
        headers: {
          Authorization: `Bearer ${await this.getAccessToken()}`,
        },
      });

    let response = await doFetch();
    if (response.status() !== 401) {
      return response;
    }

    this.accessToken = null;
    response = await doFetch();
    return response;
  }

  async getAccessToken() {
    if (this.accessToken != null) {
      return this.accessToken;
    }

    const response = await this.page.request.post('/api/auth/refresh', {
      failOnStatusCode: false,
    });
    const bodyText = await response.text();

    let payload: unknown = null;
    try {
      payload = JSON.parse(bodyText);
    } catch (_error) {
      payload = null;
    }

    if (response.status() !== 200 || !isRecord(payload) || typeof payload.token !== 'string') {
      throw new Error(
        `Expected POST /api/auth/refresh to return a JSON object with a string token. Status ${response.status()}. Body: ${bodyText}`,
      );
    }

    this.accessToken = payload.token;
    return this.accessToken;
  }

  async createConversationShell(
    options: ConversationShellOptions = {},
  ): Promise<ConversationShell> {
    const conversationId = options.conversationId ?? randomUUID();
    const title = options.title ?? `Generation tree grafting ${conversationId.slice(0, 8)}`;
    const endpoint = options.endpoint ?? 'openAI';
    const model = options.model ?? 'gpt-4o-mini';
    const createdAt = options.createdAt ?? new Date().toISOString();
    const updatedAt = options.updatedAt ?? createdAt;
    const response = await this.apiFetch('POST', '/api/convos/update', {
      arg: {
        conversationId,
        title,
        endpoint,
        model,
        createdAt,
        updatedAt,
      },
    });

    if (response.status() !== 201) {
      throw new Error(
        `Expected POST /api/convos/update to return 201. Received ${response.status()}: ${await this.readError(response)}`,
      );
    }

    this.trackedConversationIds.add(conversationId);

    return {
      conversationId,
      title,
      endpoint,
      model,
    };
  }

  async seedMessages(
    conversationId: string,
    messages: SeededMessageInput[],
    defaults: Pick<ConversationShell, 'endpoint' | 'model'> = {
      endpoint: 'openAI',
      model: 'gpt-4o-mini',
    },
  ): Promise<SeededMessage[]> {
    const baseTimeMs = Date.now();
    const seededMessages: SeededMessage[] = [];

    for (const [index, message] of messages.entries()) {
      const seededMessage: SeededMessage = {
        ...message,
        messageId: message.messageId ?? randomUUID(),
        parentMessageId: message.parentMessageId ?? NO_PARENT_MESSAGE_ID,
        sender: message.sender ?? (message.isCreatedByUser ? 'User' : 'Assistant'),
        endpoint: message.endpoint ?? defaults.endpoint,
        model: message.model ?? defaults.model,
        unfinished: message.unfinished ?? false,
        error: message.error ?? false,
        createdAt: message.createdAt ?? buildTimestamp(baseTimeMs, index),
        updatedAt: message.updatedAt ?? buildTimestamp(baseTimeMs, index),
      };
      const response = await this.apiFetch('POST', `/api/messages/${conversationId}`, {
        conversationId,
        messageId: seededMessage.messageId,
        parentMessageId: seededMessage.parentMessageId,
        isCreatedByUser: seededMessage.isCreatedByUser,
        sender: seededMessage.sender,
        text: seededMessage.text,
        content: seededMessage.content,
        endpoint: seededMessage.endpoint,
        model: seededMessage.model,
        unfinished: seededMessage.unfinished,
        error: seededMessage.error,
        finish_reason: seededMessage.finishReason,
        metadata: seededMessage.metadata,
        createdAt: seededMessage.createdAt,
        updatedAt: seededMessage.updatedAt,
      });

      if (response.status() !== 201) {
        throw new Error(
          `Expected POST /api/messages/${conversationId} to return 201. Received ${response.status()}: ${await this.readError(response)}`,
        );
      }

      seededMessages.push(seededMessage);
    }

    await this.expectSeededMessages(
      conversationId,
      seededMessages.map((message) => message.messageId),
    );

    return seededMessages;
  }

  async getConversation(conversationId: string) {
    return this.apiFetch('GET', `/api/convos/${conversationId}`);
  }

  async getMessages(conversationId: string): Promise<GraftingApiMessage[]> {
    const response = await this.apiFetch('GET', `/api/messages/${conversationId}`);

    if (response.status() !== 200) {
      throw new Error(
        `Expected GET /api/messages/${conversationId} to return 200. Received ${response.status()}: ${await this.readError(response)}`,
      );
    }

    return this.readJson<GraftingApiMessage[]>(response);
  }

  async expectSeededMessages(conversationId: string, expectedMessageIds: string[]) {
    await expect
      .poll(async () => {
        const messages = await this.getMessages(conversationId);
        const actualIds = new Set(messages.map((message) => message.messageId));
        return expectedMessageIds.every((messageId) => actualIds.has(messageId));
      })
      .toBe(true);
  }

  async deleteConversation(conversationId: string) {
    const response = await this.apiFetch('DELETE', '/api/convos', {
      arg: {
        conversationId,
      },
    });

    if (response.status() !== 201) {
      throw new Error(
        `Expected DELETE /api/convos to return 201. Received ${response.status()}: ${await this.readError(response)}`,
      );
    }

    this.trackedConversationIds.delete(conversationId);
  }

  async cleanupTrackedConversations() {
    const conversationIds = [...this.trackedConversationIds];

    for (const conversationId of conversationIds) {
      const existsResponse = await this.getConversation(conversationId);
      if (existsResponse.status() === 404) {
        this.trackedConversationIds.delete(conversationId);
        continue;
      }

      if (existsResponse.status() !== 200) {
        throw new Error(
          `Expected GET /api/convos/${conversationId} to return 200 or 404 during cleanup. Received ${existsResponse.status()}: ${await this.readError(existsResponse)}`,
        );
      }

      await this.deleteConversation(conversationId);
    }
  }
}
