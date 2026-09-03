import { IsDateString, IsOptional, IsString } from 'class-validator';
export class ReportFilterDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() cashierId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
