import { IsNumber, Min, Max, IsOptional, IsBoolean, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export type OverviewMode = 'local' | 'regional';

export class OverviewRoadsQueryDto {
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
  @Min(100)
  @Max(5000)
  @Type(() => Number)
  limit?: number = 2000;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  simplify?: boolean = true;

  @IsOptional()
  @IsString()
  @IsIn(['local', 'regional'])
  mode?: OverviewMode = 'local';
}
