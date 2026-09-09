import { UserStatus } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @Length(2, 120) name!: string;
  @IsString()
  @Matches(/^\+?[0-9][0-9 ()-]{6,29}$/, {
    message: 'phone must be a valid phone number',
  })
  phone!: string;
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
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9][0-9 ()-]{6,29}$/, {
    message: 'phone must be a valid phone number',
  })
  phone?: string;
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
