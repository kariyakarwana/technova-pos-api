import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class DailyForecastContextDto {
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  forecast_date?: string;

  @IsOptional()
  @IsString()
  forecastDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  is_open?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  isOpen?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  is_promo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  isPromo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  unit_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  @IsIn(['0', 'a', 'b', 'c'])
  state_holiday?: string;

  @IsOptional()
  @IsString()
  @IsIn(['0', 'a', 'b', 'c'])
  stateHoliday?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  school_holiday?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  schoolHoliday?: number;
}

export class DemandForecastDto {
  @IsOptional()
  @IsString()
  product_id?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  store_id?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  base_unit_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  baseUnitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  unit_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  @IsIn(['a', 'b', 'c', 'd'])
  store_type?: string;

  @IsOptional()
  @IsString()
  @IsIn(['a', 'b', 'c', 'd'])
  storeType?: string;

  @IsOptional()
  @IsString()
  @IsIn(['a', 'b', 'c'])
  assortment?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  promo2?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsIn([1, 7, 14, 30])
  horizon?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsIn([1, 7, 14, 30])
  forecastHorizon?: number;

  @IsOptional()
  @IsString()
  forecast_date?: string;

  @IsOptional()
  @IsString()
  forecastDate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyForecastContextDto)
  daily_contexts?: DailyForecastContextDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyForecastContextDto)
  dailyContexts?: DailyForecastContextDto[];
}
