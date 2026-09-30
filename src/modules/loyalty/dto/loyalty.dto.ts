import { RecordStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateLoyaltyRuleDto {
  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  spendAmount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  pointsAwarded!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000)
  redemptionValuePerPoint?: number;
}

export class UpdateLoyaltyRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  spendAmount?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pointsAwarded?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000)
  redemptionValuePerPoint?: number;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class AdjustLoyaltyPointsDto {
  @Type(() => Number)
  @IsInt()
  points!: number;

  @IsString()
  reason!: string;
}
