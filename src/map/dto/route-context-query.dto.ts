import {
  IsArray,
  IsNumber,
  IsOptional,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LngLatDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class RouteContextQueryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LngLatDto)
  routePoints!: LngLatDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  routeDistanceKm?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxLabels?: number;
}
