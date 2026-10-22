import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBrandDto, CreateCategoryDto, CreateProductDto } from './catalog.dto';
import { CreateSupplierDto } from '../../suppliers/dto/supplier.dto';
import { CreateWarrantyPolicyDto } from '../../warranties/dto/warranty.dto';

describe('catalog and contact input validation', () => {
  const product = {
    sku: 'SKU-1',
    name: 'Product',
    costPrice: 10,
    sellingPrice: 15,
    taxRate: 10,
    reorderLevel: 2,
  };

  it('rejects a whitespace-only SKU and trims valid SKU input', async () => {
    expect(await validate(plainToInstance(CreateProductDto, { ...product, sku: '   ' }))).not.toHaveLength(0);
    const dto = plainToInstance(CreateProductDto, { ...product, sku: ' SKU-1 ' });
    expect(dto.sku).toBe('SKU-1');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects invalid product prices, tax rates and fractional reorder levels', async () => {
    for (const invalid of [
      { sellingPrice: 0 },
      { sellingPrice: 100_000_000 },
      { taxRate: 0.0043 },
      { taxRate: 101 },
      { reorderLevel: 0.088 },
    ]) {
      expect(await validate(plainToInstance(CreateProductDto, { ...product, ...invalid }))).not.toHaveLength(0);
    }
  });

  it('rejects blank category and brand names', async () => {
    expect(await validate(plainToInstance(CreateCategoryDto, { name: '   ' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateBrandDto, { name: '   ' }))).not.toHaveLength(0);
  });

  it('rejects malformed supplier phones and excessive warranty durations', async () => {
    expect(await validate(plainToInstance(CreateSupplierDto, { code: 'SUP-1', name: 'Supplier', phone: 'A3243+sxkjsh67899' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateWarrantyPolicyDto, { productId: 'p-1', name: 'Policy', durationMonths: 1299 }))).not.toHaveLength(0);
  });
});
