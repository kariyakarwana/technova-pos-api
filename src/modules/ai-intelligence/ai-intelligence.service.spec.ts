import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiIntelligenceService } from './ai-intelligence.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { SalesDataExtractionService } from '../sales-forecasting/sales-data-extraction.service';
import { DemandDataExtractionService } from './demand-data-extraction.service';

describe('AiIntelligenceService - Recommendation Fallback Removal', () => {
  let service: AiIntelligenceService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      organizationUser: {
        findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-test' }),
      },
      customer: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (where.OR[0].id === 'cust-valid') {
            return Promise.resolve({ id: 'cust-valid', customerNumber: 'CUST-001', organizationId: 'org-test' });
          }
          return Promise.resolve(null);
        }),
      },
      branch: {
        findFirst: jest.fn().mockResolvedValue({ id: 'branch-1', code: 'BR-1', organizationId: 'org-test' }),
      },
      sale: {
        count: jest.fn(),
      },
    };

    const mockConfig = {
      get: jest.fn().mockReturnValue('http://localhost:8000'),
    } as unknown as ConfigService;

    const mockDemandData = {
      safeDecimalToNumber: jest.fn().mockImplementation((val) => Number(val)),
      formatInColombo: jest.fn().mockReturnValue('2026-10-01'),
    } as unknown as DemandDataExtractionService;

    service = new AiIntelligenceService(
      mockPrisma as PrismaService,
      mockConfig,
      {} as SalesDataExtractionService,
      mockDemandData,
    );
  });

  describe('CUSTOMER context', () => {
    it('throws Insufficient historical data when customer has 0 purchase history', async () => {
      mockPrisma.sale.count.mockResolvedValue(0);

      await expect(
        service.getRecommendations('user-1', {
          context: 'CUSTOMER',
          customerId: 'cust-valid',
        }),
      ).rejects.toThrow(new BadRequestException('Insufficient historical data'));
    });

    it('proceeds when customer has real purchase history', async () => {
      mockPrisma.sale.count.mockResolvedValue(5);
      jest.spyOn<any, any>(service, 'post').mockResolvedValue({
        context: 'CUSTOMER',
        recommendations: [
          { product_id: 'P1', score: 0.9, reason_code: 'CUSTOMER_HISTORY_AFFINITY', reason: 'Affinity', stock_quantity: 10, is_available: true },
        ],
      });

      const res = await service.getRecommendations('user-1', {
        context: 'CUSTOMER',
        customerId: 'cust-valid',
      });
      expect(res.recommendations).toHaveLength(1);
    });
  });

  describe('TRENDING context', () => {
    it('throws Insufficient historical data when sales count is 0', async () => {
      mockPrisma.sale.count.mockResolvedValue(0);

      await expect(
        service.getRecommendations('user-1', {
          context: 'TRENDING',
          branchId: 'branch-1',
        }),
      ).rejects.toThrow(new BadRequestException('Insufficient historical data'));
    });

    it('proceeds when real sales history exists', async () => {
      mockPrisma.sale.count.mockResolvedValue(20);
      jest.spyOn<any, any>(service, 'post').mockResolvedValue({
        context: 'TRENDING',
        recommendations: [
          { product_id: 'P2', score: 0.85, reason_code: 'TRENDING_ACCELERATION', reason: 'Trending', stock_quantity: 5, is_available: true },
        ],
      });

      const res = await service.getRecommendations('user-1', {
        context: 'TRENDING',
        branchId: 'branch-1',
      });
      expect(res.recommendations).toHaveLength(1);
    });
  });

  describe('POPULAR / COLD_START context', () => {
    it('throws Insufficient historical data when organization sales count is 0', async () => {
      mockPrisma.sale.count.mockResolvedValue(0);

      await expect(
        service.getRecommendations('user-1', {
          context: 'COLD_START',
        }),
      ).rejects.toThrow(new BadRequestException('Insufficient historical data'));

      await expect(
        service.getRecommendations('user-1', {
          context: 'POPULAR' as any,
        }),
      ).rejects.toThrow(new BadRequestException('Insufficient historical data'));
    });

    it('proceeds when real organization sales history exists', async () => {
      mockPrisma.sale.count.mockResolvedValue(100);
      jest.spyOn<any, any>(service, 'post').mockResolvedValue({
        context: 'COLD_START',
        recommendations: [
          { product_id: 'P3', score: 0.75, reason_code: 'BRANCH_POPULAR', reason: 'Popular', stock_quantity: 12, is_available: true },
        ],
      });

      const res = await service.getRecommendations('user-1', {
        context: 'COLD_START',
      });
      expect(res.recommendations).toHaveLength(1);

      const resPopular = await service.getRecommendations('user-1', {
        context: 'POPULAR' as any,
      });
      expect(resPopular.recommendations).toHaveLength(1);
    });
  });

  describe('Demand Forecasting - Multi-Tenant Category System', () => {
    it('throws Insufficient historical data when product has 0 historical sales', async () => {
      mockPrisma.product = {
        findFirst: jest.fn().mockResolvedValue({
          id: 'prod-pb',
          sku: 'SKU_PB_01',
          name: 'Anker Power Bank 20000mAh',
          sellingPrice: 45.0,
          category: { name: 'Power Banks' },
        }),
      };
      mockPrisma.saleItem = {
        count: jest.fn().mockResolvedValue(0),
      };

      await expect(
        service.demandForecast('user-1', {
          productId: 'prod-pb',
          branchId: 'branch-1',
        }),
      ).rejects.toThrow(new BadRequestException('Insufficient historical data'));
    });

    it('forwards real tenant-defined category (e.g. Power Banks, Laptops, Gaming Gear) directly to FastAPI', async () => {
      const tenantCategories = [
        'Power Banks',
        'Laptops',
        'Gaming Gear',
        'Computer Accessories',
        'Storage Devices',
        'Medicine',
        'Furniture',
      ];

      for (const catName of tenantCategories) {
        mockPrisma.product = {
          findFirst: jest.fn().mockResolvedValue({
            id: `prod-${catName}`,
            sku: `SKU-${catName}`,
            name: `Test Product ${catName}`,
            sellingPrice: 99.0,
            category: { name: catName },
          }),
        };
        mockPrisma.saleItem = {
          count: jest.fn().mockResolvedValue(15),
        };

        const postSpy = jest.spyOn<any, any>(service, 'post').mockResolvedValue({
          product_id: `SKU-${catName}`,
          store_id: 'branch-1',
          forecast_date: '2026-10-01',
          predicted_units: 14.5,
          horizon: 7,
          predictions: [],
          total_predicted_units: 14.5,
          model_metadata: {
            model_type: 'lightgbm',
            target: 'units_sold',
            feature_count: 11,
            feature_columns: [],
          },
        });

        const result = await service.demandForecast('user-1', {
          productId: `prod-${catName}`,
          branchId: 'branch-1',
          forecastHorizon: 7,
        });

        expect(result.product_id).toBe(`SKU-${catName}`);
        expect(postSpy).toHaveBeenCalledWith(
          '/v1/demand-forecast/forecast',
          expect.objectContaining({
            category: catName,
            product_id: `SKU-${catName}`,
            store_id: 'branch-1',
          }),
        );
      }
    });
  });

  describe('Recommendation System - PRODUCT context unseen DB product validation', () => {
    it('uses real DB product as source of truth and forwards runtime metadata without rejection', async () => {
      mockPrisma.product = {
        findFirst: jest.fn().mockResolvedValue({
          id: 'prod-pow-071-id',
          sku: 'PROD-POW-071',
          name: 'Power Bank Ultra 20000mAh',
          sellingPrice: 120.0,
          category: { name: 'Power Banks' },
          brand: { name: 'TechNova' },
          organizationId: 'org-test',
        }),
      };

      const postSpy = jest.spyOn<any, any>(service, 'post').mockResolvedValue({
        context: 'PRODUCT',
        organization_id: 'org-test',
        branch_id: null,
        recommendations: [],
        generated_at: new Date().toISOString(),
        model_metadata: {
          model_name: 'TechNova Hybrid Product Recommendation Engine',
          version: '1.0.0',
          algorithms_used: [],
          context: 'PRODUCT',
          total_candidates_scored: 0,
        },
      });

      const result = await service.getRecommendations('user-1', {
        context: 'PRODUCT',
        productId: 'PROD-POW-071',
      });

      expect(postSpy).toHaveBeenCalledWith(
        '/v1/recommendations/recommend',
        expect.objectContaining({
          organization_id: 'org-test',
          context: 'PRODUCT',
          product_id: 'PROD-POW-071',
          category: 'Power Banks',
          product_name: 'Power Bank Ultra 20000mAh',
          brand: 'TechNova',
          price: 120.0,
        }),
      );
      expect(result.context).toBe('PRODUCT');
      expect(result.recommendations).toEqual([]);
    });

    it('rejects product not in DB with NotFoundException', async () => {
      mockPrisma.product = {
        findFirst: jest.fn().mockResolvedValue(null),
      };

      await expect(
        service.getRecommendations('user-1', {
          context: 'PRODUCT',
          productId: 'PROD-TOTALLY-FAKE',
        }),
      ).rejects.toThrow('Product not found: PROD-TOTALLY-FAKE');
    });
  });
});
