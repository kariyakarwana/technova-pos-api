export type RecommendationReasonCode =
  | 'FREQUENTLY_BOUGHT_TOGETHER'
  | 'BRANCH_POPULAR'
  | 'CUSTOMER_HISTORY_AFFINITY'
  | 'SIMILAR_PRODUCT'
  | 'TRENDING_ACCELERATION'
  | 'COMPATIBLE_ACCESSORY'
  | 'POPULAR_FALLBACK';

export interface RecommendedProductItem {
  product_id: string;
  name: string | null;
  category: string | null;
  brand: string | null;
  price: number | null;
  score: number;
  reason_code: RecommendationReasonCode | string;
  reason: string;
  stock_quantity: number;
  is_available: boolean;
}

export interface RecommendationModelMetadata {
  model_name: string;
  version: string;
  algorithms_used: string[];
  context: string;
  total_candidates_scored: number;
  training_date_range: Record<string, string>;
  [key: string]: unknown;
}

export interface FastApiRecommendationPayload {
  organization_id: string;
  context: string;
  branch_id?: string | null;
  customer_id?: string | null;
  product_id?: string | null;
  product_ids?: string[] | null;
  top_n: number;
  include_substitutes: boolean;
  category?: string | null;
  product_name?: string | null;
  brand?: string | null;
  price?: number | null;
}

export interface RecommendationResponse {
  context: string;
  organization_id: string;
  branch_id: string | null;
  recommendations: RecommendedProductItem[];
  generated_at: string;
  model_metadata: RecommendationModelMetadata;
  [key: string]: unknown;
}
