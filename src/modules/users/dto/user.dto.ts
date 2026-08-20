import { UserStatus } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsStrongPassword,
  Length,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @Length(2, 120) name!: string;
  @IsStrongPassword({
    minLength: 12,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  password!: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) roleIds!: string[];
  @IsArray() @ArrayUnique() @IsString({ each: true }) branchIds!: string[];
}

export class UpdateUserAccessDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  branchIds?: string[];
  @IsOptional() @IsString() defaultBranchId?: string;
}
