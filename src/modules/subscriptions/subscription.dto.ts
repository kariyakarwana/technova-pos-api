import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
export class PlanChangeRequestDto {
  @IsString() @Length(1, 80) targetPlanCode: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(200) paymentRef?: string;
}
export class AddonRequestDto {
  @IsString() @Length(1, 80) type: string;
  @IsOptional() @IsInt() @Min(1) @Max(25) quantity?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(200) paymentRef?: string;
}
