import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
export class CreateRoleDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissionIds!: string[];
}
export class UpdateRoleDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionIds?: string[];
}
