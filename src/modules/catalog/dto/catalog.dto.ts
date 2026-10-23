import { RecordStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateCategoryDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(2, 120) @Matches(/\S/, { message: 'Category name cannot be blank.' }) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() parentId?: string;
}
export class UpdateCategoryDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional() @IsString() @Length(2, 120) @Matches(/\S/, { message: 'Category name cannot be blank.' }) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
export class CreateBrandDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(2, 120) @Matches(/\S/, { message: 'Brand name cannot be blank.' }) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}
export class UpdateBrandDto extends CreateBrandDto {
  @IsOptional() declare name: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class CreateProductDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 80) @Matches(/\S/, { message: 'SKU cannot be blank.' }) sku!: string;
  @IsOptional() @IsString() @MaxLength(120) barcode?: string;
  @IsString() @Length(2, 200) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brandId?: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  costPrice!: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999)
  sellingPrice!: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;
  @IsOptional() @IsBoolean() trackSerials?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderLevel?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsUrl({}, { each: true }) imageUrls?: string[];
}
export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(120) barcode?: string;
  @IsOptional() @IsString() @Length(2, 200) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brandId?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  costPrice?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999)
  sellingPrice?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;
  @IsOptional() @IsBoolean() trackSerials?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderLevel?: number;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsUrl({}, { each: true }) imageUrls?: string[];
}
export class ProductQueryDto extends PaginationDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brandId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
