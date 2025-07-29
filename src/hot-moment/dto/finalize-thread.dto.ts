import { IsString } from 'class-validator';

export class FinalizeThreadDto {
  @IsString()
  thread_id: string;
}
