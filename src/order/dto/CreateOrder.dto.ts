import { IsNumber } from 'class-validator';
export class CreateOrderDto {
  @IsNumber()
  pickupLat: number;

  @IsNumber()
  pickupLng: number;

  @IsNumber()
  deliveryLat: number;

  @IsNumber()
  deliveryLng: number;
}
