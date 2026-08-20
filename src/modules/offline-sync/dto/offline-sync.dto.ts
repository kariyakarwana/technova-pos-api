import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
export class OfflineOperationDto {
  @IsString() @Length(8, 120) clientOperationId!: string;
  @IsIn(['SALE_CREATE']) operationType!: 'SALE_CREATE';
  @IsDateString() clientTimestamp!: string;
  @IsObject() payload!: Record<string, unknown>;
}
export class OfflineSyncBatchDto {
  @IsString() @Length(8, 120) clientBatchId!: string;
  @IsString() @Length(2, 120) deviceId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OfflineOperationDto)
  operations!: OfflineOperationDto[];
}
