import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';
export class ReportFilterDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() cashierId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() roleId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxAmount?: number;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
