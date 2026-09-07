import { UserStatus } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @Length(2, 120) name!: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) roleIds!: string[];
  @IsArray() @ArrayUnique() @IsString({ each: true }) branchIds!: string[];
}

export class UserQueryDto extends PaginationDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() roleId?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
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
