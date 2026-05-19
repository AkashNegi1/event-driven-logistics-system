import { IsNumber, IsString } from 'class-validator';

export class UpdateLocationDto {

  @IsString()
  driverId: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}
