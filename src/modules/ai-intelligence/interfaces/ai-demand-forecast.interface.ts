export interface HistoricalDemandPointInput {
  date: string; // YYYY-MM-DD
  demand: number; // Daily unit demand >= 0
  is_open: number; // 1 or 0
}

export interface FutureDemandCalendarPointInput {
  date: string; // YYYY-MM-DD
  is_open: number; // 1 or 0
  promo: number; // 1 or 0
  state_holiday: number; // 0..3
  school_holiday: number; // 0 or 1
}

export interface EntityContextInput {
  store_type: number;
  assortment: number;
  competition_distance: number;
  has_competition: number;
  competition_open_months: number;
  promo2: number;
  has_active_promo2: number;
}

export interface FastApiDailyForecastContext {
  forecast_date?: string; // YYYY-MM-DD
  is_open?: number; // 0 or 1
  is_promo?: number; // 0 or 1
  unit_price?: number;
  state_holiday?: string; // '0', 'a', 'b', 'c'
  school_holiday?: number; // 0 or 1
}

export interface FastApiDemandForecastPayload {
  product_id: string;
  store_id: string;
  category: string;
  base_unit_price: number;
  unit_price?: number;
  store_type?: string;
  assortment?: string;
  promo2?: number;
  horizon?: number;
  forecast_date?: string;
  daily_contexts?: FastApiDailyForecastContext[];
  has_historical_data?: boolean;
}

export interface DailyDemandPredictionResult {
  product_id: string;
  store_id: string;
  forecast_date: string;
  predicted_units: number;
  horizon: number;
  day_of_week: number;
  is_open: number;
  is_promo: number;
  unit_price: number;
}

export interface DemandModelMetadata {
  model_type: string;
  version: string;
  target: string;
  feature_columns?: string[];
  feature_count: number;
  [key: string]: unknown;
}

export interface FastApiDemandForecastResponse {
  product_id: string;
  store_id: string;
  forecast_date: string;
  predicted_units: number;
  horizon: number;
  predictions: DailyDemandPredictionResult[];
  total_predicted_units: number;
  model_metadata: DemandModelMetadata;
  [key: string]: unknown;
}

export interface DemandForecastOptions {
  product_id?: string;
  productId?: string;
  store_id?: string;
  storeId?: string;
  branchId?: string;
  category?: string;
  base_unit_price?: number;
  baseUnitPrice?: number;
  unit_price?: number;
  unitPrice?: number;
  store_type?: string;
  storeType?: string;
  assortment?: string;
  promo2?: number;
  horizon?: number;
  forecastHorizon?: number;
  forecast_date?: string;
  forecastDate?: string;
  daily_contexts?: FastApiDailyForecastContext[];
  dailyContexts?: FastApiDailyForecastContext[];
}

export interface DemandForecastResult extends FastApiDemandForecastResponse {
  branch?: {
    id: string;
    code: string;
    name: string;
  };
  product?: {
    id: string;
    sku: string;
    name: string;
  };
  generatedAt: string;
}
