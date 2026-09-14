import { RecordStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { normalizePhone } from '../../../common/security/phone';
export class CreateCustomerDto {
  @IsString() @Length(1, 100) firstName!: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @Transform(({ value }) => normalizePhone(String(value)))
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must use international format, for example +94771234567',
  })
  phone!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsObject() address?: Record<string, string>;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  creditLimit?: number;
}
export class UpdateCustomerDto {
  @IsOptional() @IsString() @Length(1, 100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional()
  @Transform(({ value }) => normalizePhone(String(value)))
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must use international format, for example +94771234567',
  })
  phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsObject() address?: Record<string, string>;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  creditLimit?: number;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
export class CustomerQueryDto extends PaginationDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
