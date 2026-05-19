import { Injectable, Logger } from '@nestjs/common';
import type { LocalMapBounds } from './types/local-map.types.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

const REQUEST_TIMEOUT_MS = 18000;
const MAX_RETRIES = 3;

@Injectable()
export class OverpassService {
  private readonly logger = new Logger(OverpassService.name);

  async fetchBuildings(bounds: LocalMapBounds): Promise<any> {
    const query = `[out:json][timeout:15];
(
  way["building"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out body;
>;
out skel qt;`;

    this.logger.log(`[overpass] buildings query: ${query.replace(/\n/g, ' ')}`);
    return this.fetchWithRetry(query);
  }

  async fetchRoads(bounds: LocalMapBounds): Promise<any> {
    const query = `[out:json][timeout:15];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|service|unclassified"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out body;
>;
out skel qt;`;

    this.logger.log(`[overpass] roads query: ${query.replace(/\n/g, ' ')}`);
    return this.fetchWithRetry(query);
  }

  async fetchRaw(query: string): Promise<any> {
    return this.fetchWithRetry(query);
  }

  async fetchPois(bounds: LocalMapBounds): Promise<any> {
    const query = `[out:json][timeout:15];
(
  node["name"]["amenity"~"hospital|clinic|school|college|university|fuel|restaurant|cafe|bank|atm|police|bus_station"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["name"]["shop"~"mall|supermarket|convenience|department_store|marketplace"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["name"]["tourism"~"attraction|hotel|museum|viewpoint"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["name"]["railway"~"station|subway_entrance|tram_stop"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["name"]["highway"~"bus_stop|traffic_signals"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["name"]["place"~"suburb|neighbourhood|quarter|locality"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});

  way["name"]["amenity"~"hospital|clinic|school|college|university|fuel|restaurant|cafe|bank|atm|police|bus_station"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["name"]["shop"~"mall|supermarket|convenience|department_store|marketplace"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["name"]["tourism"~"attraction|hotel|museum|viewpoint"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["name"]["place"~"suburb|neighbourhood|quarter|locality"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});

  relation["name"]["amenity"~"hospital|clinic|school|college|university|fuel|restaurant|cafe|bank|atm|police|bus_station"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["name"]["shop"~"mall|supermarket|convenience|department_store|marketplace"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["name"]["tourism"~"attraction|hotel|museum|viewpoint"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["name"]["place"~"suburb|neighbourhood|quarter|locality"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out center tags;`;

    this.logger.log(`[overpass] pois query: ${query.replace(/\n/g, ' ')}`);
    return this.fetchWithRetry(query);
  }

  async fetchPlaces(
    bounds: LocalMapBounds,
    isLocalRoute: boolean,
  ): Promise<any> {
    if (isLocalRoute) {
      const query = `[out:json][timeout:15];
(
  node["place"~"city|town|suburb|neighbourhood|quarter|locality"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["place"~"suburb|neighbourhood|quarter|locality"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["place"~"suburb|neighbourhood|quarter|locality"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["boundary"="administrative"]["admin_level"~"9|10|11"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["boundary"="administrative"]["admin_level"~"9|10|11"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out center tags;`;
      this.logger.log(
        `[overpass] places local query: ${query.replace(/\n/g, ' ')}`,
      );
      return this.fetchWithRetry(query);
    } else {
      const query = `[out:json][timeout:15];
(
  node["place"~"city|town"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out body tags;`;
      this.logger.log(
        `[overpass] places long query: ${query.replace(/\n/g, ' ')}`,
      );
      return this.fetchWithRetry(query);
    }
  }

  private async fetchWithRetry(query: string): Promise<any> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          const result = await this.fetchOverpass(query, endpoint);
          this.logger.log(
            `[overpass] success endpoint=${endpoint} attempt=${attempt + 1}`,
          );
          return result;
        } catch (err: any) {
          lastError = err;
          this.logger.warn(
            `[overpass] failed endpoint=${endpoint} attempt=${attempt + 1} error=${err.message}`,
          );
        }
      }

      if (attempt < MAX_RETRIES - 1) {
        const backoff = Math.pow(2, attempt) * 1000;
        this.logger.log(`[overpass] retrying after ${backoff}ms backoff`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    throw lastError ?? new Error('All Overpass endpoints failed');
  }

  private async fetchOverpass(query: string, url: string): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const body = new URLSearchParams();
    body.set('data', query);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'realtime-logistics-demo/1.0',
        },
        body,
        signal: controller.signal,
      });

      this.logger.log(`[overpass] HTTP status: ${res.status} url=${url}`);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Overpass returned ${res.status}: ${res.statusText}. Body: ${text}`,
        );
      }

      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}
