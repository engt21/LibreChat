import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test as base, type Page, type Response } from '@playwright/test';
import {
  COMPLETE_GRAFT_BRIDGE_TEXT,
  PARTIAL_GRAFT_WARNING_TEXT,
  GenerationTreeGraftingApi,
  closeConversationTree,
  dragGraftHandleToNode,
  gotoConversation,
  isGenerationGraftBridgeMessage,
  isGenerationGraftCopyMessage,
  openConversationTree,
  type SeededMessage,
  type SeededMessageInput,
} from '../helpers/generationTreeGrafting';

const storageStatePath = path.resolve(
  process.env.E2E_STORAGE_STATE ?? path.join(process.cwd(), 'e2e/storageState.json'),
);

const test = base.extend<{ grafting: GenerationTreeGraftingApi }>({
  grafting: async ({ page }, use) => {
    const grafting = new GenerationTreeGraftingApi(page);

    try {
      await use(grafting);
    } finally {
      try {
        await grafting.cleanupTrackedConversations();
      } finally {
        const cookies = await page.context().cookies();
        if (cookies.some((cookie) => cookie.name === 'refreshToken')) {
          await page.context().storageState({ path: storageStatePath });
        }
      }
    }
  },
});

type StableLifecycle = 'complete' | 'stopped_partial';
type GraftStableState = StableLifecycle | 'aborted_partial' | 'errored_partial';
type GraftMode = 'generation' | 'subtree';
type GraftCounts = {
  messages: number;
  toolCalls: number;
  files: number;
  images: number;
  approximateTokens: number;
};
type GraftCreatedMessage = {
  messageId: string;
  text?: string | null;
};
type TGenerationGraftCreateResponse = {
  graftId: string;
  bridgeMessageId: string;
  copiedRootMessageId: string;
  activeCopiedMessageId: string;
  copiedMessageCount: number;
  createdMessages: GraftCreatedMessage[];
};
type TGenerationGraftDetailsResponse = {
  graftId: string;
  bridgeMessageId: string;
  copiedMessageIds: string[];
  continuationMessageIds: string[];
  copiedCounts: GraftCounts;
  continuationCounts: GraftCounts;
  canUndoWithoutContinuations: boolean;
  mode: GraftMode;
  sourceState: GraftStableState;
  destinationState: GraftStableState;
  copiedRootMessageId: string;
  activeCopiedMessageId: string;
};
type TGenerationGraftUndoResponse = {
  graftId: string;
  deletedMessageIds: string[];
  deletedCount: number;
};

type SeededScenario = {
  conversationId: string;
  destination: SeededMessage;
  source: SeededMessage;
  sourceLeaf?: SeededMessage;
  latestVisibleText: string;
};

const lifecycleLabel: Record<StableLifecycle, string> = {
  complete: 'Complete',
  stopped_partial: 'Stopped partial',
};

function buildLifecycleMessage(state: StableLifecycle) {
  if (state === 'complete') {
    return {
      unfinished: false,
      error: false,
    };
  }

  return {
    unfinished: true,
    error: false,
  };
}

function isCreateGraftResponse(response: Response, conversationId: string) {
  const url = new URL(response.url());
  return (
    response.request().method() === 'POST' &&
    url.pathname === `/api/messages/${conversationId}/grafts`
  );
}

function isGraftDetailsResponse(response: Response, conversationId: string, graftId: string) {
  const url = new URL(response.url());
  return (
    response.request().method() === 'GET' &&
    url.pathname === `/api/messages/${conversationId}/grafts/${graftId}`
  );
}

function isGraftDeleteResponse(response: Response, conversationId: string, graftId: string) {
  const url = new URL(response.url());
  return (
    response.request().method() === 'DELETE' &&
    url.pathname === `/api/messages/${conversationId}/grafts/${graftId}`
  );
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function seedScenario(
  grafting: GenerationTreeGraftingApi,
  {
    destinationState = 'complete',
    sourceState = 'complete',
    includeSubtree = false,
  }: {
    destinationState?: StableLifecycle;
    sourceState?: StableLifecycle;
    includeSubtree?: boolean;
  } = {},
): Promise<SeededScenario> {
  const conversationId = randomUUID();
  const tag = conversationId.slice(0, 8);
  const title = `Generation tree grafting ${tag}`;
  const shell = await grafting.createConversationShell({
    conversationId,
    title,
    endpoint: 'openAI',
    model: 'gpt-4o-mini',
  });

  const promptId = randomUUID();
  const destinationId = randomUUID();
  const sourceId = randomUUID();
  const sourceUserFollowUpId = randomUUID();
  const sourceLeafId = randomUUID();

  const baseMessages: SeededMessageInput[] = [
    {
      messageId: promptId,
      text: `Root prompt ${tag}`,
      isCreatedByUser: true,
      sender: 'User',
      parentMessageId: undefined,
    },
    {
      messageId: destinationId,
      parentMessageId: promptId,
      text: `Generation 1 destination ${tag}`,
      isCreatedByUser: false,
      sender: 'Assistant',
      ...buildLifecycleMessage(destinationState),
    },
    {
      messageId: sourceId,
      parentMessageId: promptId,
      text: `Generation 2 source ${tag}`,
      isCreatedByUser: false,
      sender: 'Assistant',
      ...buildLifecycleMessage(sourceState),
    },
  ];

  if (includeSubtree) {
    baseMessages.push(
      {
        messageId: sourceUserFollowUpId,
        parentMessageId: sourceId,
        text: `Generation 2 follow-up prompt ${tag}`,
        isCreatedByUser: true,
        sender: 'User',
      },
      {
        messageId: sourceLeafId,
        parentMessageId: sourceUserFollowUpId,
        text: `Generation 2 nested leaf ${tag}`,
        isCreatedByUser: false,
        sender: 'Assistant',
      },
    );
  }

  const seededMessages = await grafting.seedMessages(shell.conversationId, baseMessages, {
    endpoint: shell.endpoint,
    model: shell.model,
  });

  const [, destination, source] = seededMessages;

  return {
    conversationId: shell.conversationId,
    destination,
    source,
    sourceLeaf: seededMessages.find((message) => message.messageId === sourceLeafId),
    latestVisibleText: includeSubtree
      ? `Generation 2 nested leaf ${tag}`
      : `Generation 2 source ${tag}`,
  };
}

async function waitForCreateResponse(
  page: Page,
  conversationId: string,
  trigger: () => Promise<void>,
) {
  const responsePromise = page.waitForResponse((response) =>
    isCreateGraftResponse(response, conversationId),
  );

  await trigger();
  const response = await responsePromise;
  const body = await parseJson<TGenerationGraftCreateResponse & { message?: string }>(response);
  if (response.status() !== 201) {
    throw new Error(
      `Expected graft creation to return 201. Received ${response.status()}: ${
        body.message ?? JSON.stringify(body)
      }`,
    );
  }

  return body;
}

async function previewByDrag(
  page: Page,
  sourceMessageId: string,
  destinationMessageId: string,
  pointerType: 'mouse' | 'touch' = 'mouse',
) {
  await expect(page.getByTestId(`graft-handle-${sourceMessageId}`)).toBeVisible();
  await expect(page.getByTestId(`tree-node-${destinationMessageId}`)).toBeVisible();
  await dragGraftHandleToNode(page, sourceMessageId, destinationMessageId, pointerType);
  await expect(page.getByTestId('generation-tree-inspector')).toBeVisible();
}

async function previewByKeyboard(page: Page) {
  await page.getByRole('button', { name: 'Browse list' }).click();
  const source = page.getByRole('treeitem', { name: /generation 2/i });
  const destination = page.getByRole('treeitem', { name: /generation 1/i });

  await source.click();
  await source.press(' ');
  await destination.click();
  await destination.press('Enter');
  await expect(page.getByTestId('generation-tree-list-status')).toContainText('Preview requested');
}

async function previewByGuidedTap(
  page: Page,
  sourceMessageId: string,
  destinationMessageId: string,
) {
  await page.getByTestId(`tree-node-${sourceMessageId}`).click();
  await page.getByRole('button', { name: 'Use as source' }).click();
  await page.getByTestId(`tree-node-${destinationMessageId}`).click();
  await page.getByRole('button', { name: 'Append here' }).click();
  await expect(page.getByTestId('generation-tree-mobile-sheet')).toBeVisible();
}

async function assertLifecyclePreview(
  page: Page,
  {
    sourceState,
    destinationState,
    expectPartialWarning,
  }: {
    sourceState: StableLifecycle;
    destinationState: StableLifecycle;
    expectPartialWarning: boolean;
  },
) {
  const inspector = page.getByTestId('generation-tree-inspector');

  await expect(inspector).toContainText(lifecycleLabel[sourceState]);
  await expect(inspector).toContainText(lifecycleLabel[destinationState]);

  if (expectPartialWarning) {
    await expect(inspector).toContainText(PARTIAL_GRAFT_WARNING_TEXT);
    return;
  }

  await expect(inspector).not.toContainText(PARTIAL_GRAFT_WARNING_TEXT);
}

async function createFromInspector(
  page: Page,
  conversationId: string,
  mode: GraftMode = 'generation',
) {
  const modeLabel = mode === 'subtree' ? 'Whole branch from here' : 'Only this response';
  await page.getByLabel(modeLabel, { exact: false }).check();

  const appendButton = page.getByRole('button', { name: 'Append branch' });
  if (await appendButton.isDisabled()) {
    await page.getByRole('button', { name: 'Preview append' }).click();
    await expect(appendButton).toBeEnabled();
  }

  return waitForCreateResponse(page, conversationId, async () => {
    await appendButton.click();
  });
}

function graftCard(page: Page) {
  return page.locator('section', {
    has: page.getByRole('heading', { name: 'Grafted generation' }),
  });
}

async function openAndPreviewDesktop(
  page: Page,
  scenario: SeededScenario,
  pointerType: 'mouse' | 'touch' = 'mouse',
) {
  await gotoConversation(page, scenario.conversationId, scenario.latestVisibleText);
  await openConversationTree(page);
  await previewByDrag(page, scenario.source.messageId, scenario.destination.messageId, pointerType);
}

async function expectTranscriptGraftCard(page: Page, copiedText: string, copiedCountText: string) {
  await expect(page.getByRole('heading', { name: 'Grafted generation' })).toBeVisible();
  await expect(page.getByText(copiedText, { exact: false })).toBeVisible();
  await expect(page.getByText(copiedCountText)).toBeVisible();
  await expect(page.getByText(COMPLETE_GRAFT_BRIDGE_TEXT)).toHaveCount(0);
}

async function openHelpAndStartGuidedAppend(page: Page) {
  await page.getByRole('button', { name: 'How to append' }).first().click();

  const help = page.getByTestId('generation-tree-help');
  await expect(help).toBeVisible();
  await expect(
    help.getByRole('heading', {
      name: 'Example: append the full 2 of 2 branch after the 1 of 2 branch',
    }),
  ).toBeVisible();
  await expect(help).toContainText(
    'Tap the first Generation 2 of 2 response and select Whole branch from here.',
  );
  await expect(help).toContainText(
    'Tap the final response at the end of the complete Generation 1 of 2 branch.',
  );

  await help.getByRole('button', { name: 'Start guided append' }).click();
  await expect(help).toHaveCount(0);
}

test('help explains the full 2 of 2 after 1 of 2 workflow and starts guided append', async ({
  page,
  grafting,
}) => {
  const scenario = await seedScenario(grafting, { includeSubtree: true });

  await gotoConversation(page, scenario.conversationId, scenario.latestVisibleText);
  await openConversationTree(page);
  await openHelpAndStartGuidedAppend(page);

  await expect(page.getByLabel('Whole branch from here', { exact: false })).toBeChecked();
});

test('desktop drag and drop creates a generation-only graft and renders provenance instead of raw bridge text', async ({
  page,
  grafting,
}) => {
  const scenario = await seedScenario(grafting, {
    sourceState: 'complete',
    destinationState: 'complete',
  });

  await openAndPreviewDesktop(page, scenario);

  const beforeCreateMessages = await grafting.getMessages(scenario.conversationId);
  expect(beforeCreateMessages.some((message) => isGenerationGraftBridgeMessage(message))).toBe(
    false,
  );
  expect(beforeCreateMessages.some((message) => isGenerationGraftCopyMessage(message))).toBe(false);

  await expect(page.getByRole('heading', { name: 'Grafted generation' })).toHaveCount(0);

  const createResponse = await createFromInspector(page, scenario.conversationId);

  expect(createResponse.copiedMessageCount).toBe(1);
  expect(createResponse.activeCopiedMessageId).toBe(createResponse.copiedRootMessageId);

  await closeConversationTree(page);
  await expectTranscriptGraftCard(
    page,
    scenario.source.text,
    `Copied by graft: ${createResponse.copiedMessageCount}`,
  );
});

test('guarded undo deletes copied continuations but preserves the original source branch', async ({
  page,
  grafting,
}) => {
  const scenario = await seedScenario(grafting, {
    sourceState: 'complete',
    destinationState: 'complete',
  });

  await openAndPreviewDesktop(page, scenario);
  const createResponse = await createFromInspector(page, scenario.conversationId);
  await closeConversationTree(page);
  await expectTranscriptGraftCard(
    page,
    scenario.source.text,
    `Copied by graft: ${createResponse.copiedMessageCount}`,
  );

  const continuationTag = createResponse.activeCopiedMessageId.slice(0, 8);
  const continuationPromptId = randomUUID();
  const continuationAnswerId = randomUUID();
  await grafting.seedMessages(
    scenario.conversationId,
    [
      {
        messageId: continuationPromptId,
        parentMessageId: createResponse.activeCopiedMessageId,
        text: `Continuation prompt ${continuationTag}`,
        isCreatedByUser: true,
        sender: 'User',
      },
      {
        messageId: continuationAnswerId,
        parentMessageId: continuationPromptId,
        text: `Continuation answer ${continuationTag}`,
        isCreatedByUser: false,
        sender: 'Assistant',
      },
    ],
    {
      endpoint: scenario.source.endpoint ?? 'openAI',
      model: scenario.source.model ?? 'gpt-4o-mini',
    },
  );

  await page.reload();
  await page.getByRole('button', { name: 'Previous sibling message' }).click();
  await expect(page.getByRole('heading', { name: 'Grafted generation' })).toBeVisible();

  const detailsPromise = page.waitForResponse((response) =>
    isGraftDetailsResponse(response, scenario.conversationId, createResponse.graftId),
  );

  await graftCard(page).getByRole('button', { name: 'Undo graft' }).click();

  const details = await parseJson<TGenerationGraftDetailsResponse>(await detailsPromise);
  expect(details.canUndoWithoutContinuations).toBe(false);
  expect(details.continuationMessageIds).toHaveLength(2);

  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText(/This deletes 1 copied messages and 2 later continuation messages/),
  ).toBeVisible();

  const deletePromise = page.waitForResponse((response) =>
    isGraftDeleteResponse(response, scenario.conversationId, createResponse.graftId),
  );

  await dialog.getByRole('button', { name: 'Undo graft' }).click();
  const deleteResponse = await parseJson<TGenerationGraftUndoResponse>(await deletePromise);

  await expect(page.getByRole('heading', { name: 'Grafted generation' })).toHaveCount(0);

  await expect
    .poll(async () => {
      const messages = await grafting.getMessages(scenario.conversationId);
      const ids = new Set(messages.map((message) => message.messageId));
      return {
        originalSourceStillExists: ids.has(scenario.source.messageId),
        copiedMessagesRemoved: deleteResponse.deletedMessageIds.every(
          (messageId) => !ids.has(messageId),
        ),
      };
    })
    .toEqual({
      originalSourceStillExists: true,
      copiedMessagesRemoved: true,
    });

  await openConversationTree(page);
  await expect(page.getByTestId(`tree-node-${scenario.source.messageId}`)).toBeVisible();
  await closeConversationTree(page);
});

test('immediate undo removes a graft without destructive confirmation when there are no continuations', async ({
  page,
  grafting,
}) => {
  const scenario = await seedScenario(grafting);

  await openAndPreviewDesktop(page, scenario);
  const createResponse = await createFromInspector(page, scenario.conversationId);
  await closeConversationTree(page);
  await expectTranscriptGraftCard(
    page,
    scenario.source.text,
    `Copied by graft: ${createResponse.copiedMessageCount}`,
  );

  const detailsPromise = page.waitForResponse((response) =>
    isGraftDetailsResponse(response, scenario.conversationId, createResponse.graftId),
  );
  const deletePromise = page.waitForResponse((response) =>
    isGraftDeleteResponse(response, scenario.conversationId, createResponse.graftId),
  );

  await graftCard(page).getByRole('button', { name: 'Undo graft' }).click();

  const details = await parseJson<TGenerationGraftDetailsResponse>(await detailsPromise);
  expect(details.canUndoWithoutContinuations).toBe(true);
  await parseJson<TGenerationGraftUndoResponse>(await deletePromise);

  await expect(
    page.getByRole('heading', { name: 'Undo graft and delete later continuations?' }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Grafted generation' })).toHaveCount(0);
});

test.describe('lifecycle matrix', () => {
  for (const [name, sourceState, destinationState] of [
    ['complete to complete', 'complete', 'complete'],
    ['partial to complete', 'stopped_partial', 'complete'],
    ['complete to partial', 'complete', 'stopped_partial'],
    ['partial to partial', 'stopped_partial', 'stopped_partial'],
  ] as const) {
    test(`creates ${name} grafts and exposes the expected lifecycle preview`, async ({
      page,
      grafting,
    }) => {
      const scenario = await seedScenario(grafting, {
        sourceState,
        destinationState,
      });

      await openAndPreviewDesktop(page, scenario);
      await assertLifecyclePreview(page, {
        sourceState,
        destinationState,
        expectPartialWarning: sourceState !== 'complete' || destinationState !== 'complete',
      });

      const createResponse = await createFromInspector(page, scenario.conversationId);
      await closeConversationTree(page);
      await expectTranscriptGraftCard(
        page,
        scenario.source.text,
        `Copied by graft: ${createResponse.copiedMessageCount}`,
      );
    });
  }
});

test('subtree graft copies the descendant branch and keeps the copied leaf as the active target', async ({
  page,
  grafting,
}) => {
  const scenario = await seedScenario(grafting, {
    sourceState: 'complete',
    destinationState: 'complete',
    includeSubtree: true,
  });

  await openAndPreviewDesktop(page, scenario);
  const createResponse = await createFromInspector(page, scenario.conversationId, 'subtree');

  expect(createResponse.copiedMessageCount).toBe(3);
  expect(createResponse.activeCopiedMessageId).not.toBe(createResponse.copiedRootMessageId);
  expect(
    createResponse.createdMessages.some(
      (message) =>
        message.messageId === createResponse.activeCopiedMessageId &&
        message.text === scenario.sourceLeaf?.text,
    ),
  ).toBe(true);

  await closeConversationTree(page);
  await expectTranscriptGraftCard(
    page,
    scenario.sourceLeaf?.text ?? scenario.source.text,
    `Copied by graft: ${createResponse.copiedMessageCount}`,
  );
});

test('keyboard tree list path supports source selection with Space and destination selection with Enter', async ({
  page,
  grafting,
}) => {
  const scenario = await seedScenario(grafting);

  await gotoConversation(page, scenario.conversationId, scenario.latestVisibleText);
  await openConversationTree(page);
  await previewByKeyboard(page);
  await assertLifecyclePreview(page, {
    sourceState: 'complete',
    destinationState: 'complete',
    expectPartialWarning: false,
  });

  const createResponse = await createFromInspector(page, scenario.conversationId);
  await closeConversationTree(page);
  await expectTranscriptGraftCard(
    page,
    scenario.source.text,
    `Copied by graft: ${createResponse.copiedMessageCount}`,
  );
});

test.describe('mobile', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('mobile guided taps append a whole branch and support undo', async ({ page, grafting }) => {
    const scenario = await seedScenario(grafting, { includeSubtree: true });

    await gotoConversation(page, scenario.conversationId, scenario.latestVisibleText);
    await openConversationTree(page);
    await openHelpAndStartGuidedAppend(page);
    await previewByGuidedTap(page, scenario.source.messageId, scenario.destination.messageId);

    const createResponse = await createFromInspector(page, scenario.conversationId, 'subtree');
    expect(createResponse.copiedMessageCount).toBeGreaterThan(1);
    await closeConversationTree(page);
    await expectTranscriptGraftCard(
      page,
      scenario.source.text,
      `Copied by graft: ${createResponse.copiedMessageCount}`,
    );

    const deletePromise = page.waitForResponse((response) =>
      isGraftDeleteResponse(response, scenario.conversationId, createResponse.graftId),
    );

    await graftCard(page).getByRole('button', { name: 'Undo graft' }).click();
    await parseJson<TGenerationGraftUndoResponse>(await deletePromise);
    await expect(page.getByRole('heading', { name: 'Grafted generation' })).toHaveCount(0);
  });
});
