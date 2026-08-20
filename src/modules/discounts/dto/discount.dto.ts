import { DiscountType, RecordStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
export class CreateDiscountRuleDto {
  @IsOptional() @IsString() productId?: string;
  @IsString() @Length(2, 120) name!: string;
  @IsEnum(DiscountType) type!: DiscountType;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) value!: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1)
  minimumQuantity!: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1)
  maximumQuantity?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() priority?: number;
  @IsOptional() @IsBoolean() stackable?: boolean;
}
export class UpdateDiscountRuleDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  value?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1)
  minimumQuantity?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1)
  maximumQuantity?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() priority?: number;
  @IsOptional() @IsBoolean() stackable?: boolean;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
