import { NotificationChannel, RecordStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
export class CreateTemplateDto {
  @IsString() @Length(2, 80) eventType!: string;
  @IsEnum(NotificationChannel) channel!: NotificationChannel;
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() @MaxLength(200) subjectTemplate?: string;
  @IsString() @Length(2, 10000) bodyTemplate!: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
export class UpdateTemplateDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @MaxLength(200) subjectTemplate?: string;
  @IsOptional() @IsString() @Length(2, 10000) bodyTemplate?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
export class PreferenceDto {
  @IsString() customerId!: string;
  @IsEnum(NotificationChannel) channel!: NotificationChannel;
  @IsString() eventType!: string;
  @IsBoolean() enabled!: boolean;
}
export class OutboxQueryDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsEnum(NotificationChannel) channel?: NotificationChannel;
}
export class AppNotificationQueryDto extends PaginationDto {
  @IsOptional() @IsString() unread?: string;
}
export class WebhookDto {
  @IsString() providerEventId!: string;
  @IsString() eventType!: string;
  @IsObject() payload!: Record<string, unknown>;
}
