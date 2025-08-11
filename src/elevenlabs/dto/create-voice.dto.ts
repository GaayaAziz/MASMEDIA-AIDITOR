// src/elevenlabs/dto/create-voice.dto.ts
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateVoiceDto {
  @IsString() @IsNotEmpty()
  name!: string;              // e.g., "Journalist EN clone"

  @IsOptional() @IsString()
  description?: string;       // optional

  @IsOptional() @IsString()
  labels?: string;            // optional JSON string per API (e.g. '{"lang":"en"}')
}
