export interface TechNovaForecastFeatureRow {
  // Identifiers & Partition keys
  organization_id: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  date: string; // YYYY-MM-DD

  // Supervised Learning Target
  daily_revenue: number;

  // Calendar features
  day_of_week: number;     // 0=Monday, 6=Sunday
  day_of_month: number;    // 1-31
  month: number;           // 1-12
  week_of_year: number;    // 1-53
  is_weekend: number;      // 1 if Saturday or Sunday, else 0
  is_month_start: number;  // 1 if day_of_month <= 3, else 0
  is_month_end: number;    // 1 if day_of_month >= 28, else 0

  // Cyclical calendar encodings
  day_of_week_sin: number;
  day_of_week_cos: number;
  month_sin: number;
  month_cos: number;

  // Point-in-time historical lag features (strictly <= t-1)
  // Null when historical observations are insufficient
  revenue_lag_1: number | null;
  revenue_lag_7: number | null;
  revenue_lag_14: number | null;
  revenue_lag_28: number | null;

  // Point-in-time trailing rolling aggregations (strictly <= t-1)
  rolling_mean_7: number | null;
  rolling_mean_14: number | null;
  rolling_mean_28: number | null;
  rolling_std_7: number | null;
  rolling_std_28: number | null;

  // Dynamic momentum signal
  weekly_momentum_ratio: number | null;

  // Branch profile features (expanding point-in-time strictly <= t-1)
  branch_age_days: number;
  branch_historical_avg_sales: number | null;

  // Known-future operational features
  is_operating_day: number;
  active_discount_count: number;

  // Quality & Readiness flag
  has_sufficient_history: boolean; // true if >= 28 days of history precede this row
}

export interface FeatureEngineeringValidationReport {
  generated_at: string;
  organizations: string[];
  branches: string[];
  total_source_rows: number;
  total_feature_rows: number;
  date_range: {
    start_date: string | null;
    end_date: string | null;
  };
  feature_columns: string[];
  rows_with_sufficient_history: number;
  rows_without_sufficient_history: number;
  null_counts: Record<string, number>;
  zero_revenue_row_count: number;
  isolation_passed: boolean;
  leakage_check_passed: boolean;
}

export interface FeatureEngineeringOptions {
  minHistoryDays?: number; // Default: 28
  branchInceptionDates?: Map<string, string>; // branchId -> YYYY-MM-DD
  activeDiscountsByDate?: Map<string, number>; // branchId::date -> active discount count
}
