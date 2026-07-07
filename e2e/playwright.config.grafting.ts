import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const defaultBaseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3081';
const defaultStorageState =
  process.env.E2E_STORAGE_STATE ?? path.resolve(process.cwd(), 'e2e/storageState.json');

function assertSafeBaseUrl(baseUrl: string) {
  if (process.env.E2E_ALLOW_PRODUCTION === 'YES') {
    return;
  }

  const parsedUrl = new URL(baseUrl);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

  if (!allowedHosts.has(parsedUrl.hostname)) {
    throw new Error(
      `Refusing to run generation tree grafting e2e tests against non-localhost target "${baseUrl}". Set E2E_ALLOW_PRODUCTION=YES to override intentionally.`,
    );
  }
}

assertSafeBaseUrl(defaultBaseUrl);

export default defineConfig({
  testDir: path.resolve(process.cwd(), 'e2e/specs'),
  testMatch: /generation-tree-grafting\.spec\.ts/,
  outputDir: path.resolve(process.cwd(), 'e2e/specs/.test-results/grafting'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: path.resolve(process.cwd(), 'e2e/playwright-report/grafting'),
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: defaultBaseUrl,
    storageState: defaultStorageState,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
