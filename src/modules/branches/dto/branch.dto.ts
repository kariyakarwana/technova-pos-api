import {
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { RecordStatus } from '@prisma/client';

export class CreateBranchDto {
  @IsString() @Length(2, 30) code!: string;
  @IsString() @Length(2, 150) name!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsObject() address?: Record<string, string>;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsObject() address?: Record<string, string>;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
