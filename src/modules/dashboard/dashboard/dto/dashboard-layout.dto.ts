import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class WidgetPositionDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(48)
  x!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  y!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  w!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  h!: number;
}

export class WidgetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ValidateNested()
  @Type(() => WidgetPositionDto)
  position!: WidgetPositionDto;

  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}

export class DashboardLayoutDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  columns: number = 12;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(500)
  rowHeight: number = 80;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WidgetDto)
  widgets!: WidgetDto[];
}
