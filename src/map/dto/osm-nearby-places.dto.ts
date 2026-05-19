import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class OsmNearbyPlacesDto {
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
  @Min(0.1)
  @Max(100)
  @Type(() => Number)
  radiusKm?: number = 10;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  placeTypes?: string;
}
