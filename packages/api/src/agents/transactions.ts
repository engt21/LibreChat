import { CANCEL_RATE } from '@librechat/data-schemas';
import type { TCustomConfig, TTransactionsConfig } from 'librechat-data-provider';
import type { TransactionData, TransactionPricingSource } from '@librechat/data-schemas';
import type { EndpointTokenConfig } from '~/types/tokens';

interface GetMultiplierParams {
  valueKey?: string;
  tokenType?: string;
  model?: string;
  endpointTokenConfig?: EndpointTokenConfig;
  inputTokenCount?: number;
}

interface GetCacheMultiplierParams {
  cacheType: 'write' | 'read';
  model?: string;
  endpointTokenConfig?: EndpointTokenConfig;
  inputTokenCount?: number;
}

interface ResolvedRateInfo {
  rate: number;
  source: TransactionPricingSource;
}

interface ResolvedCacheRateInfo {
  rate: number | null;
  source: TransactionPricingSource;
}

export interface PricingFns {
  getMultiplier: (params: GetMultiplierParams) => number;
  getCacheMultiplier: (params: GetCacheMultiplierParams) => number | null;
  getRateInfo?: (params: GetMultiplierParams) => ResolvedRateInfo;
  getCacheRateInfo?: (params: GetCacheMultiplierParams) => ResolvedCacheRateInfo;
}

interface BaseTxData {
  user: string;
  model?: string;
  endpoint?: string;
  context: string;
  messageId?: string;
  conversationId: string;
  endpointTokenConfig?: EndpointTokenConfig;
  balance?: Partial<TCustomConfig['balance']> | null;
  transactions?: Partial<TTransactionsConfig>;
}

interface StandardTxData extends BaseTxData {
  tokenType: string;
  rawAmount: number;
  inputTokenCount?: number;
  valueKey?: string;
}

interface StructuredTxData extends BaseTxData {
  tokenType: string;
  inputTokens?: number;
  writeTokens?: number;
  readTokens?: number;
  inputTokenCount?: number;
  rawAmount?: number;
}

export interface PreparedEntry {
  doc: TransactionData;
  tokenValue: number;
  balance?: Partial<TCustomConfig['balance']> | null;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface StructuredPromptTokens {
  input?: number;
  write?: number;
  read?: number;
}

export interface StructuredTokenUsage {
  promptTokens?: StructuredPromptTokens;
  completionTokens?: number;
}

export interface TxMetadata {
  user: string;
  model?: string;
  endpoint?: string;
  context: string;
  messageId?: string;
  conversationId: string;
  balance?: Partial<TCustomConfig['balance']> | null;
  transactions?: Partial<TTransactionsConfig>;
  endpointTokenConfig?: EndpointTokenConfig;
}

export interface BulkWriteDeps {
  insertMany: (docs: TransactionData[]) => Promise<unknown>;
  updateBalance: (params: { user: string; incrementValue: number }) => Promise<unknown>;
}

function aggregatePricingSource(sources: TransactionPricingSource[]): TransactionPricingSource {
  if (sources.includes('fallback')) {
    return 'fallback';
  }

  if (sources.includes('endpoint_config')) {
    return 'endpoint_config';
  }

  return 'catalog';
}

function normalizeInputTokenCount(inputTokenCount?: number): number | undefined {
  return Number.isFinite(inputTokenCount) ? inputTokenCount : undefined;
}

function resolveRateInfo(pricing: PricingFns, params: GetMultiplierParams): ResolvedRateInfo {
  if (pricing.getRateInfo) {
    return pricing.getRateInfo(params);
  }

  return {
    rate: pricing.getMultiplier(params),
    source: 'fallback',
  };
}

function resolveCacheRateInfo(
  pricing: PricingFns,
  params: GetCacheMultiplierParams,
): ResolvedCacheRateInfo {
  if (pricing.getCacheRateInfo) {
    return pricing.getCacheRateInfo(params);
  }

  return {
    rate: pricing.getCacheMultiplier(params),
    source: 'fallback',
  };
}

function calculateTokenValue(
  txData: StandardTxData,
  pricing: PricingFns,
): { tokenValue: number; rate: number; pricingSource: TransactionPricingSource } {
  const { tokenType, model, endpointTokenConfig, rawAmount, valueKey } = txData;
  const inputTokenCount = normalizeInputTokenCount(txData.inputTokenCount);
  const rateInfo = resolveRateInfo(pricing, {
    valueKey,
    tokenType,
    model,
    endpointTokenConfig,
    inputTokenCount,
  });
  const multiplier = Math.abs(rateInfo.rate);
  let rate = multiplier;
  let tokenValue = rawAmount * multiplier;
  if (txData.context === 'incomplete' && tokenType === 'completion') {
    tokenValue = Math.ceil(tokenValue * CANCEL_RATE);
    rate *= CANCEL_RATE;
  }
  return { tokenValue, rate, pricingSource: rateInfo.source };
}

function calculateStructuredTokenValue(
  txData: StructuredTxData,
  pricing: PricingFns,
): {
  tokenValue: number;
  rate: number;
  rawAmount: number;
  rateDetail?: Record<string, number>;
  pricingSource: TransactionPricingSource;
  pricingSourceDetail?: Record<string, TransactionPricingSource>;
} {
  const { tokenType, model, endpointTokenConfig } = txData;
  const inputTokenCount = normalizeInputTokenCount(txData.inputTokenCount);

  if (!tokenType) {
    return {
      tokenValue: txData.rawAmount ?? 0,
      rate: 0,
      rawAmount: txData.rawAmount ?? 0,
      pricingSource: 'fallback',
    };
  }

  if (tokenType === 'prompt') {
    const inputRateInfo = resolveRateInfo(pricing, {
      tokenType: 'prompt',
      model,
      endpointTokenConfig,
      inputTokenCount,
    });
    const writeRateInfo = resolveCacheRateInfo(pricing, {
      cacheType: 'write',
      model,
      endpointTokenConfig,
      inputTokenCount,
    });
    const readRateInfo = resolveCacheRateInfo(pricing, {
      cacheType: 'read',
      model,
      endpointTokenConfig,
      inputTokenCount,
    });
    const inputMultiplier = inputRateInfo.rate;
    const writeMultiplier = writeRateInfo.rate ?? inputMultiplier;
    const readMultiplier = readRateInfo.rate ?? inputMultiplier;

    const inputAbs = Math.abs(txData.inputTokens ?? 0);
    const writeAbs = Math.abs(txData.writeTokens ?? 0);
    const readAbs = Math.abs(txData.readTokens ?? 0);
    const totalPromptTokens = inputAbs + writeAbs + readAbs;
    const pricingSourceDetail = {
      input: inputRateInfo.source,
      write: writeRateInfo.source,
      read: readRateInfo.source,
    } satisfies Record<string, TransactionPricingSource>;
    const appliedSources: TransactionPricingSource[] = [];
    if (inputAbs > 0) {
      appliedSources.push(pricingSourceDetail.input);
    }
    if (writeAbs > 0) {
      appliedSources.push(pricingSourceDetail.write);
    }
    if (readAbs > 0) {
      appliedSources.push(pricingSourceDetail.read);
    }

    const rate =
      totalPromptTokens > 0
        ? (Math.abs(inputMultiplier * (txData.inputTokens ?? 0)) +
            Math.abs(writeMultiplier * (txData.writeTokens ?? 0)) +
            Math.abs(readMultiplier * (txData.readTokens ?? 0))) /
          totalPromptTokens
        : Math.abs(inputMultiplier);

    const tokenValue = -(
      inputAbs * inputMultiplier +
      writeAbs * writeMultiplier +
      readAbs * readMultiplier
    );

    return {
      tokenValue,
      rate,
      rawAmount: -totalPromptTokens,
      rateDetail: { input: inputMultiplier, write: writeMultiplier, read: readMultiplier },
      pricingSource:
        appliedSources.length > 0
          ? aggregatePricingSource(appliedSources)
          : pricingSourceDetail.input,
      pricingSourceDetail,
    };
  }

  const rateInfo = resolveRateInfo(pricing, {
    tokenType,
    model,
    endpointTokenConfig,
    inputTokenCount,
  });
  const rawAmount = -Math.abs(txData.rawAmount ?? 0);
  let rate = Math.abs(rateInfo.rate);
  let tokenValue = rawAmount * rateInfo.rate;

  if (txData.context === 'incomplete' && tokenType === 'completion') {
    tokenValue = Math.ceil(tokenValue * CANCEL_RATE);
    rate *= CANCEL_RATE;
  }

  return { tokenValue, rate, rawAmount, pricingSource: rateInfo.source };
}

function prepareStandardTx(
  _txData: StandardTxData & {
    balance?: Partial<TCustomConfig['balance']> | null;
    transactions?: Partial<TTransactionsConfig>;
  },
  pricing: PricingFns,
): PreparedEntry | null {
  const { balance, transactions, ...txData } = _txData;
  if (txData.rawAmount != null && isNaN(txData.rawAmount)) {
    return null;
  }
  if (transactions?.enabled === false) {
    return null;
  }

  const normalizedInputTokenCount = normalizeInputTokenCount(txData.inputTokenCount);
  const normalizedTxData = { ...txData, inputTokenCount: normalizedInputTokenCount };

  const { tokenValue, rate, pricingSource } = calculateTokenValue(normalizedTxData, pricing);
  return {
    doc: { ...normalizedTxData, tokenValue, rate, pricingSource },
    tokenValue,
    balance,
  };
}

function prepareStructuredTx(
  _txData: StructuredTxData & {
    balance?: Partial<TCustomConfig['balance']> | null;
    transactions?: Partial<TTransactionsConfig>;
  },
  pricing: PricingFns,
): PreparedEntry | null {
  const { balance, transactions, ...txData } = _txData;
  if (transactions?.enabled === false) {
    return null;
  }

  const normalizedInputTokenCount = normalizeInputTokenCount(txData.inputTokenCount);
  const normalizedTxData = { ...txData, inputTokenCount: normalizedInputTokenCount };
  const { tokenValue, rate, rawAmount, rateDetail, pricingSource, pricingSourceDetail } =
    calculateStructuredTokenValue(normalizedTxData, pricing);
  return {
    doc: {
      ...normalizedTxData,
      tokenValue,
      rate,
      rawAmount,
      pricingSource,
      ...(rateDetail && { rateDetail }),
      ...(pricingSourceDetail && { pricingSourceDetail }),
    },
    tokenValue,
    balance,
  };
}

export function prepareTokenSpend(
  txData: TxMetadata,
  tokenUsage: TokenUsage,
  pricing: PricingFns,
): PreparedEntry[] {
  const { promptTokens, completionTokens } = tokenUsage;
  const results: PreparedEntry[] = [];
  const normalizedPromptTokens = Math.max(promptTokens ?? 0, 0);

  if (promptTokens !== undefined) {
    const entry = prepareStandardTx(
      {
        ...txData,
        tokenType: 'prompt',
        rawAmount: promptTokens === 0 ? 0 : -normalizedPromptTokens,
        inputTokenCount: normalizedPromptTokens,
      },
      pricing,
    );
    if (entry) {
      results.push(entry);
    }
  }

  if (completionTokens !== undefined) {
    const entry = prepareStandardTx(
      {
        ...txData,
        tokenType: 'completion',
        rawAmount: completionTokens === 0 ? 0 : -Math.max(completionTokens, 0),
        inputTokenCount: normalizedPromptTokens,
      },
      pricing,
    );
    if (entry) {
      results.push(entry);
    }
  }

  return results;
}

export function prepareStructuredTokenSpend(
  txData: TxMetadata,
  tokenUsage: StructuredTokenUsage,
  pricing: PricingFns,
): PreparedEntry[] {
  const { promptTokens, completionTokens } = tokenUsage;
  const results: PreparedEntry[] = [];

  if (promptTokens) {
    const input = Math.max(promptTokens.input ?? 0, 0);
    const write = Math.max(promptTokens.write ?? 0, 0);
    const read = Math.max(promptTokens.read ?? 0, 0);
    const totalInputTokens = input + write + read;
    const entry = prepareStructuredTx(
      {
        ...txData,
        tokenType: 'prompt',
        inputTokens: -input,
        writeTokens: -write,
        readTokens: -read,
        inputTokenCount: totalInputTokens,
      },
      pricing,
    );
    if (entry) {
      results.push(entry);
    }
  }

  if (completionTokens) {
    const totalInputTokens = promptTokens
      ? Math.max(promptTokens.input ?? 0, 0) +
        Math.max(promptTokens.write ?? 0, 0) +
        Math.max(promptTokens.read ?? 0, 0)
      : undefined;
    const entry = prepareStandardTx(
      {
        ...txData,
        tokenType: 'completion',
        rawAmount: -Math.max(completionTokens, 0),
        inputTokenCount: totalInputTokens,
      },
      pricing,
    );
    if (entry) {
      results.push(entry);
    }
  }

  return results;
}

export async function bulkWriteTransactions(
  { user, docs }: { user: string; docs: PreparedEntry[] },
  dbOps: BulkWriteDeps,
): Promise<void> {
  if (!docs.length) {
    return;
  }

  let totalTokenValue = 0;
  let balanceEnabled = false;
  const plainDocs = docs.map(({ doc, tokenValue, balance }) => {
    if (balance?.enabled) {
      balanceEnabled = true;
      totalTokenValue += tokenValue;
    }
    return doc;
  });

  if (balanceEnabled) {
    await dbOps.updateBalance({ user, incrementValue: totalTokenValue });
  }

  await dbOps.insertMany(plainDocs);
}
