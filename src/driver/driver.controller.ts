import { Body, Controller, Param, Post } from '@nestjs/common';
import { DriverService } from './driver.service.js';
import { UpdateLocationDto } from './dto/updateLocation.dto.js';
@Controller('driver')
export class DriverController {
  constructor(private driverService: DriverService) {}
  @Post(':id/location')
  updateLocation(
    @Param('id') driverId: string,
    @Body() data: UpdateLocationDto,
  ) {
    return this.driverService.updateLocation({
      driverId,
      lat: data.lat,
      lng: data.lng,
    });
  }

  @Post('start-delivery')
  startDelivery(
    @Body('orderId') orderId: string,
    @Body('driverId') driverId: string,
  ) {
    return this.driverService.startDelivery(orderId, driverId);
  }

  @Post('complete-delivery')
  completeDelivery(
    @Body('orderId') orderId: string,
    @Body('driverId') driverId: string,
  ) {
    return this.driverService.completeDelivery(orderId, driverId);
  }
}
