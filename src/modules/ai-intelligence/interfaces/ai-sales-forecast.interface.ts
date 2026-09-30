export interface DailyRevenuePointInput {
  date: string; // YYYY-MM-DD
  revenue: number;
  is_operating_day: number;
}

export interface FutureCalendarPointInput {
  date: string; // YYYY-MM-DD
  is_operating_day: number;
  active_discounts: number;
}

export interface FastApiSalesForecastPayload {
  organization_id: string;
  branch_id: string;
  forecast_horizon: number;
  recent_daily_revenue: DailyRevenuePointInput[];
  future_calendar: FutureCalendarPointInput[];
}

export interface DailyForecastPredictionResult {
  date: string;
  predicted_revenue: number;
}

export interface FastApiSalesForecastResponse {
  organization_id: string;
  branch_id: string;
  forecast_horizon: number;
  predictions: DailyForecastPredictionResult[];
  [key: string]: unknown;
}

export interface SalesForecastOptions {
  branchId?: string;
  forecastHorizon?: number;
}

export interface SalesForecastResult extends FastApiSalesForecastResponse {
  branch: {
    id: string;
    code: string;
    name: string;
  };
  generatedAt: string;
  historyDays: number;
}
