import { NotificationChannel, RecordStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
export class CreateTemplateDto {
  @IsString() eventType!: string;
  @IsEnum(NotificationChannel) channel!: NotificationChannel;
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() subjectTemplate?: string;
  @IsString() bodyTemplate!: string;
}
export class UpdateTemplateDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() subjectTemplate?: string;
  @IsOptional() @IsString() bodyTemplate?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}
export class PreferenceDto {
  @IsString() customerId!: string;
  @IsEnum(NotificationChannel) channel!: NotificationChannel;
  @IsString() eventType!: string;
  @IsBoolean() enabled!: boolean;
}
export class OutboxQueryDto extends PaginationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsEnum(NotificationChannel) channel?: NotificationChannel;
}
export class WebhookDto {
  @IsString() providerEventId!: string;
  @IsString() eventType!: string;
  @IsObject() payload!: Record<string, unknown>;
}
