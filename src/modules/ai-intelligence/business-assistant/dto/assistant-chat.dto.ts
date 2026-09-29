import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AssistantChatDto {
  @IsString()
  @IsNotEmpty({ message: 'Message query must not be empty.' })
  @MaxLength(1000, { message: 'Message cannot exceed 1000 characters.' })
  message!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}
