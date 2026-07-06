export type TransactionPricingSource = 'catalog' | 'endpoint_config' | 'fallback';

export interface TransactionData {
  user: string;
  conversationId: string;
  tokenType: string;
  model?: string;
  endpoint?: string;
  context?: string;
  valueKey?: string;
  rate?: number;
  rawAmount?: number;
  tokenValue?: number;
  inputTokens?: number;
  writeTokens?: number;
  readTokens?: number;
  messageId?: string;
  inputTokenCount?: number;
  rateDetail?: Record<string, number>;
  pricingSource?: TransactionPricingSource;
  pricingSourceDetail?: Record<string, TransactionPricingSource>;
}
