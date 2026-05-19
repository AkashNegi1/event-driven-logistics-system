import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RoutePoint {
  lat: number;
  lng: number;
}

function interpolateRoute(
  pickup: RoutePoint,
  destination: RoutePoint,
  count: number,
): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push({
      lat: pickup.lat + (destination.lat - pickup.lat) * t,
      lng: pickup.lng + (destination.lng - pickup.lng) * t,
    });
  }
  return points;
}

@Injectable()
export class OsrmRouteService {
  private readonly logger = new Logger(OsrmRouteService.name);
  private readonly osrmUrl: string;

  constructor(private configService: ConfigService) {
    this.osrmUrl = this.configService
      .get<string>('OSRM_URL')
      ?.replace(/\/+$/, '') ?? 'https://router.project-osrm.org';
  }

  async getRoutePoints(
    pickup: RoutePoint,
    destination: RoutePoint,
  ): Promise<{ points: RoutePoint[]; source: 'osrm' | 'linear-fallback' }> {
    try {
      const url =
        `${this.osrmUrl}/route/v1/driving/` +
        `${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}` +
        `?overview=full&geometries=geojson`;

      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (!res.ok) {
        throw new Error(`OSRM returned ${res.status}: ${res.statusText}`);
      }

      const body: any = await res.json();

      if (!body?.routes?.[0]?.geometry?.coordinates) {
        throw new Error('OSRM response missing geometry coordinates');
      }

      const coords: [number, number][] = body.routes[0].geometry.coordinates;
      const points: RoutePoint[] = coords.map(([lng, lat]) => ({ lat, lng }));

      this.logger.log({
        msg: '[simulator] route loaded',
        orderId: undefined,
        points: points.length,
        source: 'osrm' as const,
      });

      return { points, source: 'osrm' };
    } catch (err: any) {
      this.logger.warn(
        `[simulator] OSRM fetch failed (${err.message}), using linear fallback`,
      );
      const points = interpolateRoute(pickup, destination, 100);

      this.logger.log({
        msg: '[simulator] route loaded',
        orderId: undefined,
        points: points.length,
        source: 'linear-fallback' as const,
      });

      return { points, source: 'linear-fallback' };
    }
  }
}
