import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../../common/dto/pagination.dto';
import { DashboardLayoutDto } from './dashboard-layout.dto';

export class CreateDashboardDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ValidateNested()
  @Type(() => DashboardLayoutDto)
  layout!: DashboardLayoutDto;
}

export class UpdateDashboardDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  branchId?: string | null;

  @IsOptional()
  @IsString()
  userId?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateDashboardLayoutDto {
  @ValidateNested()
  @Type(() => DashboardLayoutDto)
  layout!: DashboardLayoutDto;
}

export class DashboardQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isDefault?: boolean;
}

export class ApplyTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateId!: string;
}
