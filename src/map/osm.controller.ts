import { Controller, Get, Query } from '@nestjs/common';
import { OsmDatabaseService } from './osm-database.service.js';
import { OsmNearbyPlacesDto } from './dto/osm-nearby-places.dto.js';

@Controller('map/osm')
export class OsmController {
  constructor(private readonly osmDb: OsmDatabaseService) {}

  @Get('health')
  async getHealth() {
    const health = await this.osmDb.getHealth();
    return {
      source: 'local-osm',
      ...health,
    };
  }

  @Get('nearby-places')
  async getNearbyPlaces(@Query() dto: OsmNearbyPlacesDto) {
    const radiusKm = dto.radiusKm ?? 10;
    const limit = dto.limit ?? 50;

    const params: any[] = [dto.lng, dto.lat, radiusKm * 1000, limit];
    let placeFilter = '';

    if (dto.placeTypes) {
      const types = dto.placeTypes
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length > 0) {
        placeFilter = `AND place_type = ANY($${params.length + 1}::text[])`;
        params.push(types);
      }
    }

    const result = await this.osmDb.query(
      `SELECT
          name,
          place_type AS "placeType",
          state,
          ST_Y(geom) AS lat,
          ST_X(geom) AS lng,
          ST_Distance(
            geom::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          ) / 1000 AS "distanceKm"
        FROM osm_places
        WHERE ST_DWithin(
          geom::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3
        )
        ${placeFilter}
        ORDER BY "distanceKm" ASC
        LIMIT $4`,
      params,
    );

    return {
      count: result.rows.length,
      source: 'local-osm',
      places: result.rows,
    };
  }
}
