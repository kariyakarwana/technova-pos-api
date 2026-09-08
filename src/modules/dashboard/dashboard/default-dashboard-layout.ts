export interface DefaultDashboardWidget {
  id: string;
  type: string;
  title: string;
  position: { x: number; y: number; w: number; h: number };
  settings: Record<string, unknown>;
}

export interface DefaultDashboardLayout {
  version: number;
  columns: number;
  rowHeight: number;
  widgets: DefaultDashboardWidget[];
}

export const DEFAULT_BACKEND_DASHBOARD_LAYOUT: DefaultDashboardLayout = {
  version: 1,
  columns: 12,
  rowHeight: 80,
  widgets: [
    {
      id: 'widget-metrics-grid',
      type: 'metrics_grid',
      title: 'Key Performance Indicators',
      position: { x: 0, y: 0, w: 12, h: 4 },
      settings: {},
    },
    {
      id: 'widget-sales-purchase-chart',
      type: 'sales_purchase_chart',
      title: 'Sales & Purchase Trends',
      position: { x: 0, y: 4, w: 8, h: 5 },
      settings: {},
    },
    {
      id: 'widget-overall-information',
      type: 'overall_information',
      title: 'Overall Information',
      position: { x: 8, y: 4, w: 4, h: 5 },
      settings: {},
    },
    {
      id: 'widget-top-selling-products',
      type: 'top_selling_products',
      title: 'Top Selling Products',
      position: { x: 0, y: 9, w: 4, h: 4 },
      settings: {},
    },
    {
      id: 'widget-low-stock-products',
      type: 'low_stock_products',
      title: 'Low Stock Alert',
      position: { x: 4, y: 9, w: 4, h: 4 },
      settings: {},
    },
    {
      id: 'widget-recent-sales',
      type: 'recent_sales',
      title: 'Recent Sales',
      position: { x: 8, y: 9, w: 4, h: 4 },
      settings: {},
    },
    {
      id: 'widget-top-customers',
      type: 'top_customers',
      title: 'Top Customers',
      position: { x: 0, y: 13, w: 4, h: 4 },
      settings: {},
    },
    {
      id: 'widget-top-categories',
      type: 'top_categories',
      title: 'Top Categories',
      position: { x: 4, y: 13, w: 4, h: 4 },
      settings: {},
    },
    {
      id: 'widget-order-heatmap',
      type: 'order_heatmap',
      title: 'Order Statistics Heatmap',
      position: { x: 8, y: 13, w: 4, h: 4 },
      settings: {},
    },
  ],
};
