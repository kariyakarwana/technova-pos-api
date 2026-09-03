import { PaymentMethod, ReturnResolution, ReturnStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
export class ReturnLineDto {
  @IsString() saleItemId!: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;
  @IsOptional() @IsString() condition?: string;
  @IsOptional() @IsBoolean() restock?: boolean;
}
export class CreateReturnDto {
  @IsString() saleId!: string;
  @IsString() reason!: string;
  @IsOptional() @IsEnum(PaymentMethod) refundMethod?: PaymentMethod;
  @IsOptional() @IsString() refundReference?: string;
  @IsOptional() @IsEnum(ReturnResolution) resolution?: ReturnResolution;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items!: ReturnLineDto[];
}
export class ReturnQueryDto extends PaginationDto {
  @IsOptional() @IsString() saleId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() customerPhone?: string;
  @IsOptional() @IsEnum(ReturnStatus) status?: ReturnStatus;
  @IsOptional() @IsEnum(ReturnResolution) resolution?: ReturnResolution;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
