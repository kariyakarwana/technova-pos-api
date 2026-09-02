import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class EmailDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class VerifyResetOtpDto {
  @IsString()
  @MinLength(20)
  challengeToken!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  resetToken!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @MinLength(20)
  token!: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
