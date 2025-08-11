import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VoiceSettingsDto } from './voice-settings.dto';

export class CreateSpeechDto {
  @IsString() @IsNotEmpty() @MaxLength(40000)
  text!: string;

  @IsString() @IsNotEmpty()
  voiceId!: string;

  @IsOptional() @IsString()
  modelId?: string; // default handled in service

  @IsOptional() @ValidateNested() @Type(() => VoiceSettingsDto)
  voiceSettings?: VoiceSettingsDto;
}
