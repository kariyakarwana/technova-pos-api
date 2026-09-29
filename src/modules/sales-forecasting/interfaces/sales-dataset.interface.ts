export type DayOperationalStatus =
  | 'operating_sales'       // Observed positive transactions on this date
  | 'operating_zero_sales'  // Active branch within observed lifecycle, but zero recorded sales
  | 'pre_launch'            // Date is prior to the branch's first recorded transaction
  | 'unsynced_offline';     // Terminal unsynchronized or offline gap

export interface RawSaleRow {
  id: string;
  organizationId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  status: string;
  total: number;
  completedAt: Date | null;
  createdAt: Date;
  transactionDate: Date; // COALESCE(completedAt, createdAt)
  dateStr: string;       // YYYY-MM-DD in Asia/Colombo
}

export interface BranchDailyRevenueRow {
  organization_id: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  date: string; // YYYY-MM-DD in Asia/Colombo
  daily_revenue: number; // SUM(Sale.total)
  transaction_count: number;
  day_of_week: number; // 0=Monday, 6=Sunday
  is_weekend: number;  // 1 if Saturday or Sunday, else 0
  operational_status: DayOperationalStatus;
  is_operating_day: number; // 1 or 0
}

export interface BranchSummaryReport {
  branch_id: string;
  branch_code: string;
  branch_name: string;
  first_sale_date: string | null;
  last_sale_date: string | null;
  observed_days: number;
  active_sales_days: number;
  zero_sales_days: number;
  total_revenue: number;
  min_daily_revenue: number;
  max_daily_revenue: number;
  avg_daily_revenue: number;
  has_sufficient_history: boolean; // >= 28 days
}

export interface DatasetValidationReport {
  generated_at: string;
  organization_count: number;
  total_branches: number;
  total_daily_rows: number;
  total_revenue: number;
  min_daily_revenue: number;
  max_daily_revenue: number;
  overall_date_range: {
    start_date: string | null;
    end_date: string | null;
  };
  insufficient_history_branch_count: number;
  branches: BranchSummaryReport[];
}

export interface ExtractionOptions {
  branchId?: string;
  startDate?: Date;
  endDate?: Date;
  minHistoryDays?: number;
}
