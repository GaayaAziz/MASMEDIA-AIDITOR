import { IsString, MinLength } from 'class-validator';

export class AnalyzeParagraphDto {
  @IsString()
  thread_id: string;

  @IsString()
  @MinLength(10)
  paragraph: string;
}
