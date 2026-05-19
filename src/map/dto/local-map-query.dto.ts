import { IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class LocalMapQueryDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(500)
  @Max(2500)
  @Type(() => Number)
  radius?: number;
}
