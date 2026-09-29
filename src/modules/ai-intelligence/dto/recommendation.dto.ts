import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const SUPPORTED_RECOMMENDATION_CONTEXTS = [
  'CUSTOMER',
  'PRODUCT',
  'BRANCH',
  'TRENDING',
  'COLD_START',
  'CART_READY',
  'POPULAR',
] as const;

export type RecommendationContextType =
  (typeof SUPPORTED_RECOMMENDATION_CONTEXTS)[number];

export class RecommendationDto {
  @IsOptional()
  @IsString()
  organization_id?: string;

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsString()
  @IsIn(SUPPORTED_RECOMMENDATION_CONTEXTS, {
    message:
      'context must be one of: CUSTOMER, PRODUCT, BRANCH, TRENDING, COLD_START, CART_READY',
  })
  context: RecommendationContextType;

  @IsOptional()
  @IsString()
  customer_id?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  product_id?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  product_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  @IsOptional()
  @IsString()
  branch_id?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  top_n?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topN?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  include_substitutes?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeSubstitutes?: boolean;
}
