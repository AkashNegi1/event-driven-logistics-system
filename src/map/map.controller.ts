import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { MapService } from './map.service.js';
import { ConfigService } from '@nestjs/config';
import { RouteContextQueryDto } from './dto/route-context-query.dto.js';
import { OverviewRoadsQueryDto } from './dto/overview-roads-query.dto.js';
import type { OverviewMode } from './dto/overview-roads-query.dto.js';
import { OverviewPlacesQueryDto } from './dto/overview-places-query.dto.js';

@Controller('map')
export class MapController {
  constructor(
    private readonly mapService: MapService,
    private readonly configService: ConfigService,
  ) {}

  @Get('local')
  async getLocalMap(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius') radius?: string,
  ) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      throw new BadRequestException('lat must be a number between -90 and 90');
    }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      throw new BadRequestException(
        'lng must be a number between -180 and 180',
      );
    }

    const radiusNum = radius ? parseFloat(radius) : 1000;
    if (isNaN(radiusNum) || radiusNum < 500 || radiusNum > 1500) {
      throw new BadRequestException('radius must be between 500 and 1500');
    }

    return this.mapService.getLocalMap(latNum, lngNum, radiusNum);
  }

  @Get('overview/roads')
  async getOverviewRoads(@Query() dto: OverviewRoadsQueryDto) {
    if (dto.minLat >= dto.maxLat) {
      throw new BadRequestException('minLat must be less than maxLat');
    }
    if (dto.minLng >= dto.maxLng) {
      throw new BadRequestException('minLng must be less than maxLng');
    }

    const lngDiff = dto.maxLng - dto.minLng;
    const latDiff = dto.maxLat - dto.minLat;
    if (lngDiff > 5 || latDiff > 5) {
      throw new BadRequestException(
        'Bounding box too large — max 5 degrees per dimension',
      );
    }

    return this.mapService.getOverviewRoadsByBbox(dto);
  }

  @Get('overview/places')
  async getOverviewPlaces(@Query() dto: OverviewPlacesQueryDto) {
    if (dto.minLat >= dto.maxLat) {
      throw new BadRequestException('minLat must be less than maxLat');
    }
    if (dto.minLng >= dto.maxLng) {
      throw new BadRequestException('minLng must be less than maxLng');
    }

    const lngDiff = dto.maxLng - dto.minLng;
    const latDiff = dto.maxLat - dto.minLat;
    if (lngDiff > 5 || latDiff > 5) {
      throw new BadRequestException(
        'Bounding box too large — max 5 degrees per dimension',
      );
    }

    return this.mapService.getOverviewPlacesByBbox(dto);
  }

  @Get('debug-overpass')
  async debugOverpass(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius') radius?: string,
  ) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      throw new BadRequestException('lat must be a number between -90 and 90');
    }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      throw new BadRequestException(
        'lng must be a number between -180 and 180',
      );
    }

    const radiusNum = radius ? parseFloat(radius) : 1000;
    return this.mapService.debugOverpass(latNum, lngNum, radiusNum);
  }

  @Delete('cache/local')
  async clearLocalMapCache() {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    const enableClear =
      this.configService.get<string>('ENABLE_MAP_CACHE_CLEAR') === 'true';

    if (isProduction && !enableClear) {
      throw new ForbiddenException('Cache clear is disabled in production');
    }

    const deleted = await this.mapService.clearLocalMapCache();
    return { pattern: 'local-map:*', deleted };
  }

  @Delete('cache/route-context')
  async clearRouteContextCache() {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    const enableClear =
      this.configService.get<string>('ENABLE_MAP_CACHE_CLEAR') === 'true';

    if (isProduction && !enableClear) {
      throw new ForbiddenException('Cache clear is disabled in production');
    }

    const deleted = await this.mapService.clearRouteContextCache();
    return { pattern: 'route-context:*', deleted };
  }

  @Post('route-context')
  async getRouteContext(@Body() dto: RouteContextQueryDto) {
    if (!dto.routePoints || dto.routePoints.length < 2) {
      throw new BadRequestException('routePoints must have at least 2 points');
    }
    return this.mapService.getRouteContext(dto);
  }
}
