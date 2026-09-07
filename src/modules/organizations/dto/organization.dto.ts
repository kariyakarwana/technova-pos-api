import { Type } from 'class-transformer';
import {
  IsEmail,
  IsBoolean,
  IsHexColor,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BrandingDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  receiptLogoUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;
}

export class UpdateOrganizationDto {
  @IsOptional() @IsBoolean() supplierPortalEnabled?: boolean;
  @IsOptional() @IsBoolean() supplierOrderChangesEnabled?: boolean;
  @IsOptional() @IsBoolean() supplierEmailNotificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() supplierInAppNotificationsEnabled?: boolean;
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
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsObject()
  address?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingDto)
  branding?: BrandingDto;
}
