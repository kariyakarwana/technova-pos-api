import {
  SupplierResponseStatus,
  SupplierShipmentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class SupplierPortalOrderQueryDto extends PaginationDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class SupplierResponseLineDto {
  @IsString() purchaseOrderItemId!: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001)
  proposedQuantity?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  proposedUnitCost?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RespondToPurchaseOrderDto {
  @IsEnum(SupplierResponseStatus) status!: SupplierResponseStatus;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsDateString() proposedExpectedAt?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true }) @Type(() => SupplierResponseLineDto)
  lines?: SupplierResponseLineDto[];
}

export class ReviewSupplierResponseDto {
  @IsBoolean() approved!: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class DispatchSupplierOrderDto {
  @IsOptional() @IsString() @MaxLength(120) carrier?: string;
  @IsOptional() @IsString() @MaxLength(120) trackingNumber?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsDateString() expectedArrival?: string;
  @IsOptional() @IsEnum(SupplierShipmentStatus) status?: SupplierShipmentStatus;
}

export class UploadSupplierInvoiceDto {
  @IsString() @MaxLength(120) invoiceNumber!: string;
  @IsString() @MaxLength(240) fileName!: string;
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) mimeType!: string;
  @IsBase64() @MaxLength(7_100_000) base64Data!: string;
  @IsOptional() @IsString() shipmentId?: string;
}

export class SupplierPortalPreferencesDto {
  @IsOptional() @IsBoolean() emailNotificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() inAppNotificationsEnabled?: boolean;
}
