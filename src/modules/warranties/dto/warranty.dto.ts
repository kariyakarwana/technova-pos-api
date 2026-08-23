import { RecordStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
export class CreateWarrantyPolicyDto {
  @IsString() productId!: string;
  @IsString() @Length(2, 120) name!: string;
  @Type(() => Number) @IsInt() @Min(1) durationMonths!: number;
  @IsOptional() @IsString() terms?: string;
}
export class UpdateWarrantyPolicyDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) durationMonths?: number;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
export class ActivateWarrantyDto {
  @IsString() token!: string;
}
