import { IsNumber, Min, Max, IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export type OverviewMode = 'local' | 'regional';

export class OverviewPlacesQueryDto {
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  minLng!: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  minLat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  maxLng!: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  maxLat!: number;

  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(50)
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @IsIn(['local', 'regional'])
  mode?: OverviewMode = 'local';
}
