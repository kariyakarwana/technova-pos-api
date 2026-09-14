import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CustomerProductQueryDto extends PaginationDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() categoryId?: string;
}

export class CustomerNotificationQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: 'true' | 'false';
}
