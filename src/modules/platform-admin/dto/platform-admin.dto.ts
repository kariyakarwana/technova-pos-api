import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  AddonQuotaTarget,
  PlanTier,
  RecordStatus,
  UserStatus,
} from '@prisma/client';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsEmail()
  email?: string;

  @IsString()
  @IsNotEmpty()
  planCode: string; // "BASIC", "STANDARD", "PROFESSIONAL", "ENTERPRISE"

  // Initial Tenant Admin Credentials
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  adminName: string;

  @IsEmail()
  adminEmail: string;

  @IsOptional()
  @IsString()
  adminPhone?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsString()
  @Length(8, 100)
  temporaryPassword?: string;

  // Initial Branch
  @IsOptional()
  @IsString()
  @Length(2, 100)
  branchName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 30)
  branchCode?: string;
}

export class UpdateTenantStatusDto {
  @IsEnum(RecordStatus)
  status: RecordStatus; // ACTIVE or INACTIVE
}

export class ChangeTenantPlanDto {
  @IsString()
  @IsNotEmpty()
  planCode: string; // "BASIC", "STANDARD", "PROFESSIONAL", "ENTERPRISE"
}

export class AllocateAddonDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class RecordPaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentMethod: string; // e.g. "BANK_TRANSFER", "CASH"

  @IsString()
  @IsNotEmpty()
  paymentRef: string; // e.g. "BOC-TXN-12345"

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsEmail()
  email?: string;
}

export class UpdateTenantAdminDto {
  @IsOptional()
  @IsString()
  @IsIn(['EDIT', 'REPLACE'])
  mode?: 'EDIT' | 'REPLACE';

  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  @Length(8, 100)
  newPassword?: string;
}

export class PlanFeatureItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  description?: string;

  @IsBoolean()
  enabled: boolean;
}

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 50)
  code: string;

  @IsOptional()
  @IsEnum(PlanTier)
  tier?: PlanTier;

  @IsString()
  @IsNotEmpty()
  @Length(2, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsNumber()
  @Min(0)
  priceUsd: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;

  @IsOptional()
  @IsString()
  @IsIn(['MONTHLY', 'ANNUAL'])
  billingCycle?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsInt()
  @Min(1)
  maxBranches: number;

  @IsInt()
  @Min(1)
  maxInternalUsers: number;

  @IsInt()
  @Min(0)
  monthlyEmailLimit: number;

  @IsInt()
  @Min(0)
  monthlyWhatsAppBills: number;

  @IsInt()
  @Min(0)
  monthlyWhatsAppMarketing: number;

  @IsInt()
  @Min(0)
  monthlyAiRequests: number;

  @IsBoolean()
  multiBranchEnabled: boolean;

  @IsBoolean()
  emailEnabled: boolean;

  @IsBoolean()
  whatsAppBillsEnabled: boolean;

  @IsBoolean()
  whatsAppMarketingEnabled: boolean;

  @IsBoolean()
  aiEnabled: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureItemDto)
  features?: PlanFeatureItemDto[];
}

export class UpdatePlanDto {
  @IsOptional()
  @IsEnum(PlanTier)
  tier?: PlanTier;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;

  @IsOptional()
  @IsString()
  @IsIn(['MONTHLY', 'ANNUAL'])
  billingCycle?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxBranches?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxInternalUsers?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyEmailLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyWhatsAppBills?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyWhatsAppMarketing?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyAiRequests?: number;

  @IsOptional()
  @IsBoolean()
  multiBranchEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsAppBillsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsAppMarketingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureItemDto)
  features?: PlanFeatureItemDto[];
}

export class CreateAddonPackDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 60)
  code: string;

  @IsString()
  @IsNotEmpty()
  @Length(2, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsEnum(AddonQuotaTarget)
  quotaTarget: AddonQuotaTarget;

  @IsInt()
  @Min(0)
  unitsPerPack: number;

  @IsNumber()
  @Min(0)
  priceUsd: number;

  @IsOptional()
  @IsString()
  @IsIn(['ONE_TIME', 'MONTHLY'])
  billingCycle?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureItemDto)
  features?: PlanFeatureItemDto[];
}

export class UpdateAddonPackDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsEnum(AddonQuotaTarget)
  quotaTarget?: AddonQuotaTarget;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitsPerPack?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceUsd?: number;

  @IsOptional()
  @IsString()
  @IsIn(['ONE_TIME', 'MONTHLY'])
  billingCycle?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureItemDto)
  features?: PlanFeatureItemDto[];
}

export class ReviewSubscriptionRequestDto {
  @IsString()
  @IsIn(['APPROVE', 'REJECT'])
  action: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reviewNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentRef?: string;

  @IsOptional()
  @IsBoolean()
  markPaid?: boolean;
}
