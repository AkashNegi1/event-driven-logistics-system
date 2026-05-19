import { Controller, Post, Body } from '@nestjs/common';
import { DriverService } from './driver.service.js';
import { UpdateLocationDto } from './dto/updateLocation.dto.js';

@Controller('driver')
export class DriverController {
  constructor(private driverService: DriverService) {}
  @Post('location')
  async updateLocation(@Body() dto: UpdateLocationDto) {
    return await this.driverService.updateLocation(dto);
  }
}
