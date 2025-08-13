import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class VoiceSettingsDto {
  @IsOptional() @IsNumber() stability?: number;           // 0..1
  @IsOptional() @IsNumber() similarityBoost?: number;     // 0..1
  @IsOptional() @IsNumber() style?: number;               // 0..1
  @IsOptional() @IsBoolean() useSpeakerBoost?: boolean;   // true/false
}
