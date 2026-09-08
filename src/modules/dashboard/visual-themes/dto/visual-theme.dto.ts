import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

// Color regex supporting hex (#rgb, #rrggbb, #rrggbbaa), rgb/rgba, and hsl/hsla
const COLOR_REGEX =
  /^#([0-9a-fA-F]{3,8})$|^(rgba?|hsla?)\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+%?)?\s*\)$/;

const SAFE_FONT_REGEX = /^[a-zA-Z0-9\s\-_,'"]+$/;
const SAFE_RADIUS_REGEX = /^[0-9]+(px|rem|em|%)?$/;

@ValidatorConstraint({ name: 'isSafeCustomVariables', async: false })
class IsSafeCustomVariablesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;

    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof key !== 'string' || !/^[a-zA-Z0-9\-_]+$/.test(key)) {
        return false;
      }
      if (typeof val !== 'string') {
        return false;
      }
      // Reject dangerous CSS injection patterns, scripts, URLs, HTML tags, or expressions
      const lower = val.toLowerCase();
      if (
        lower.includes('<') ||
        lower.includes('>') ||
        lower.includes('javascript:') ||
        lower.includes('expression(') ||
        lower.includes('url(') ||
        lower.includes('@import') ||
        lower.includes('data:')
      ) {
        return false;
      }
      if (val.length > 200) {
        return false;
      }
    }
    return true;
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} contains unsafe characters, expressions, or disallowed keys/values.`;
  }
}

export class VisualThemeTokensDto {
  @IsOptional()
  @IsString()
  @IsIn(['light', 'dark', 'system'])
  mode?: 'light' | 'dark' | 'system';

  @IsOptional()
  @IsString()
  @Matches(COLOR_REGEX, {
    message: 'primaryColor must be a valid hex, rgb(a), or hsl(a) color',
  })
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(COLOR_REGEX, {
    message: 'secondaryColor must be a valid hex, rgb(a), or hsl(a) color',
  })
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(COLOR_REGEX, {
    message: 'backgroundColor must be a valid hex, rgb(a), or hsl(a) color',
  })
  backgroundColor?: string;

  @IsOptional()
  @IsString()
  @Matches(COLOR_REGEX, {
    message: 'cardBackground must be a valid hex, rgb(a), or hsl(a) color',
  })
  cardBackground?: string;

  @IsOptional()
  @IsString()
  @Matches(COLOR_REGEX, {
    message: 'surfaceColor must be a valid hex, rgb(a), or hsl(a) color',
  })
  surfaceColor?: string;

  @IsOptional()
  @IsString()
  @Matches(COLOR_REGEX, {
    message: 'textColor must be a valid hex, rgb(a), or hsl(a) color',
  })
  textColor?: string;

  @IsOptional()
  @IsString()
  @Matches(SAFE_RADIUS_REGEX, {
    message: 'borderRadius must be a valid CSS dimension (e.g. 8px, 0.5rem, 4)',
  })
  borderRadius?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SAFE_FONT_REGEX, {
    message: 'fontFamily must contain only safe font names and standard fallbacks',
  })
  fontFamily?: string;

  @IsOptional()
  @IsObject()
  @Validate(IsSafeCustomVariablesConstraint)
  customVariables?: Record<string, string>;
}

export class CreateVisualThemeDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ValidateNested()
  @Type(() => VisualThemeTokensDto)
  tokens!: VisualThemeTokensDto;
}

export class UpdateVisualThemeDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => VisualThemeTokensDto)
  tokens?: VisualThemeTokensDto;
}

export class VisualThemeQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}
