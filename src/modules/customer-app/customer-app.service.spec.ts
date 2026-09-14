import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma/prisma.service';
import { CustomerAppService } from './customer-app.service';
import { CustomerProductQueryDto } from './dto/customer-app.dto';

describe('CustomerAppService', () => {
  it('rejects a signed-in user without a linked customer profile', async () => {
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new CustomerAppService(
      prisma as unknown as PrismaService,
    );

    await expect(service.profile('staff-user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns customer-safe product availability and media', async () => {
    const product = {
      id: 'product-1',
      sku: 'MOUSE-001',
      barcode: null,
      name: 'Wireless Mouse',
      description: 'Compact wireless mouse',
      sellingPrice: 4500,
      taxRate: 0,
      category: { id: 'category-1', name: 'Accessories' },
      brand: { id: 'brand-1', name: 'TechNova' },
      images: [{ id: 'image-1', url: '/image.jpg', altText: null, position: 0 }],
      videos: [{ id: 'video-1', url: '/video.mp4', originalName: 'demo.mp4' }],
      stockLevels: [
        {
          quantityOnHand: 5,
          quantityReserved: 2,
          branch: { id: 'branch-1', name: 'Main', code: 'MAIN' },
        },
      ],
    };
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'customer-1',
          organizationId: 'org-1',
          customerNumber: 'CUS-000001',
          status: 'ACTIVE',
        }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([product]),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest
        .fn()
        .mockImplementation((operations: Array<Promise<unknown>>) =>
          Promise.all(operations),
        ),
    };
    const service = new CustomerAppService(
      prisma as unknown as PrismaService,
    );
    const query = new CustomerProductQueryDto();

    const result = await service.products('customer-user', query);

    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: 'product-1',
        availableQuantity: 3,
        availabilityByBranch: [
          {
            branch: { id: 'branch-1', name: 'Main', code: 'MAIN' },
            inStock: true,
          },
        ],
      }),
    );
    expect(result.data[0]).not.toHaveProperty('stockLevels');
    expect(result.data[0]).not.toHaveProperty('costPrice');
  });
});

