import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../../common/dto/pagination.dto';
import { DashboardLayoutDto } from '../../dashboard/dto/dashboard-layout.dto';

export class CreateDashboardTemplateDto {
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
  @MaxLength(100)
  category?: string;

  @ValidateNested()
  @Type(() => DashboardLayoutDto)
  layout!: DashboardLayoutDto;
}

export class UpdateDashboardTemplateDto {
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
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardLayoutDto)
  layout?: DashboardLayoutDto;
}

export class DashboardTemplateQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
