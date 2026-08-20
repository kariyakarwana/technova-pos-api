import { RecordStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
export class CreateSupplierDto {
  @IsString() @Length(1, 40) code!: string;
  @IsString() @Length(2, 160) name!: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsObject() address?: Record<string, string>;
}
export class UpdateSupplierDto {
  @IsOptional() @IsString() @Length(2, 160) name?: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsObject() address?: Record<string, string>;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
