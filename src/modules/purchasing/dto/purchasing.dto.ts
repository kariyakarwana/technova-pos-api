import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
export class PurchaseOrderItemDto {
  @IsString() productId!: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost!: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tax?: number;
}
export class CreatePurchaseOrderDto {
  @IsString() branchId!: string;
  @IsString() supplierId!: string;
  @IsOptional() @IsDateString() expectedAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}
export class PurchaseQueryDto extends PaginationDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() status?: string;
}
export class ReceiptItemDto {
  @IsString() purchaseOrderItemId!: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;
  @IsOptional() @IsArray() @IsString({ each: true }) serialNumbers?: string[];
}
export class ReceivePurchaseOrderDto {
  @IsString() receiptNumber!: string;
  @IsOptional() @IsString() supplierInvoiceNumber?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items!: ReceiptItemDto[];
}
