import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizePhone } from '../../../common/security/phone';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class CustomerLoginDto {
  @Transform(({ value }) => normalizePhone(String(value)))
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must use international format, for example +94771234567',
  })
  phone!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class CustomerRefreshDto {
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}
