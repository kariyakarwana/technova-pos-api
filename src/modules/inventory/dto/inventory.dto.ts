import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
export class AdjustmentDto {
  @IsString() branchId!: string;
  @IsString() productId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) quantityDelta!: number;
  @IsString() reason!: string;
}
export class TransferItemDto {
  @IsString() productId!: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;
}
export class CreateTransferDto {
  @IsString() sourceBranchId!: string;
  @IsString() destinationBranchId!: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items!: TransferItemDto[];
}
export class DispatchSerialsDto {
  @IsString() productId!: string;
  @IsArray() @IsString({ each: true }) serialNumbers!: string[];
}
export class DispatchTransferDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispatchSerialsDto)
  serializedItems?: DispatchSerialsDto[];
}
export class InventoryQueryDto extends PaginationDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() search?: string;
}
