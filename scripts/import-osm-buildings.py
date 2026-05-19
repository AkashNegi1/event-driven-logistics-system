#!/usr/bin/env python3
"""Import building footprints from India OSM PBF into PostGIS osm_buildings.

City-bbox only — not all India.
Processes ways only, skips relations.

Usage:
    CITY=delhi python scripts/import-osm-buildings.py
"""

import os
import sys
import re
import json
import time
import osmium
import psycopg2
from psycopg2.extras import execute_values

DB_CONFIG = {
    'dbname': os.environ.get('OSM_DB_NAME', 'osm_india'),
    'user': os.environ.get('OSM_DB_USER', 'osm'),
    'password': os.environ.get('OSM_DB_PASSWORD', 'osm'),
    'host': os.environ.get('OSM_DB_HOST', 'postgres-osm'),
    'port': int(os.environ.get('OSM_DB_PORT', '5432')),
}

PBF_PATH = os.environ.get('PBF_PATH', '/data/india.osm.pbf')
CITY = os.environ.get('CITY', '').lower().strip()
FORCE_REIMPORT = os.environ.get('FORCE_REIMPORT', '').lower() in ('true', '1', 'yes')
BATCH_SIZE = 2000
LOG_INTERVAL = 5000

CITY_BBOXES = {
    'delhi': (28.40, 76.84, 28.88, 77.35),
    'chandigarh': (30.55, 76.55, 30.90, 76.95),
}


def parse_height(tags: dict) -> float | None:
    for key in ('height', 'building:height'):
        val = tags.get(key)
        if val is None:
            continue
        val = str(val).strip().lower()
        m = re.match(r'^([\d.]+)\s*m', val)
        if m:
            return float(m.group(1))
        try:
            return float(val)
        except ValueError:
            continue
    return None


def parse_levels(tags: dict) -> int | None:
    for key in ('building:levels', 'levels'):
        val = tags.get(key)
        if val is None:
            continue
        try:
            lvl = int(float(str(val).strip()))
            if lvl > 0:
                return lvl
        except ValueError:
            continue
    return None


def make_multipolygon_wkt(coords: list) -> str | None:
    if len(coords) < 3:
        return None
    first = coords[0]
    last = coords[-1]
    if first[0] != last[0] or first[1] != last[1]:
        coords.append(first)
    if len(coords) < 4:
        return None
    pts = ', '.join(f'{lon} {lat}' for lon, lat in coords)
    return f'SRID=4326;MULTIPOLYGON((({pts})))'


class BuildingHandler(osmium.SimpleHandler):
    def __init__(self, conn, cursor, city_bbox):
        super().__init__()
        self.conn = conn
        self.cursor = cursor
        self.city_bbox = city_bbox
        self.batch = []
        self.count = 0
        self.start_time = time.time()

    def way(self, w):
        tags = dict(w.tags)
        if 'building' not in tags:
            return

        coords = [(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
        if len(coords) < 3:
            return

        if self.city_bbox:
            south, west, north, east = self.city_bbox
            inside = False
            for lon, lat in coords:
                if south <= lat <= north and west <= lon <= east:
                    inside = True
                    break
            if not inside:
                return

        wkt = make_multipolygon_wkt(coords)
        if wkt is None:
            return

        height = parse_height(tags)
        levels = parse_levels(tags)

        self.batch.append((
            f'w{w.id}',
            tags.get('name'),
            tags.get('building'),
            height,
            levels,
            json.dumps(tags, ensure_ascii=False),
            CITY,
            wkt,
        ))
        self._maybe_flush()

    def _maybe_flush(self):
        if len(self.batch) >= BATCH_SIZE:
            self.flush()

    def flush(self):
        if not self.batch:
            return
        try:
            execute_values(
                self.cursor,
                """INSERT INTO osm_buildings
                   (osm_id, name, building, height_meters, levels, tags, source_city, geom)
                   VALUES %s
                   ON CONFLICT (osm_id) DO NOTHING""",
                self.batch,
                template="(%s, %s, %s, %s::real, %s::smallint, %s::jsonb, %s, ST_GeomFromEWKT(%s))",
            )
            self.conn.commit()
            before = self.count
            self.count += len(self.batch)
            elapsed = time.time() - self.start_time
            if self.count // LOG_INTERVAL > before // LOG_INTERVAL:
                print(f'  committed {self.count} buildings [{elapsed:.0f}s]', flush=True)
            self.batch = []
        except Exception as e:
            print(f'ERROR during batch insert: {e}', flush=True)
            self.conn.rollback()
            raise


def ensure_schema(cursor):
    cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS osm_buildings (
            id          BIGSERIAL PRIMARY KEY,
            osm_id      TEXT NOT NULL,
            osm_type    TEXT NOT NULL DEFAULT 'way',
            name        TEXT,
            building    TEXT,
            height_meters REAL,
            levels      SMALLINT,
            tags        JSONB,
            source_city TEXT,
            geom        geometry(MultiPolygon, 4326)
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_osm_buildings_geom
        ON osm_buildings USING GIST (geom)
    """)
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_osm_buildings_osm_id
        ON osm_buildings (osm_id)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_osm_buildings_source_city
        ON osm_buildings (source_city)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_osm_buildings_building
        ON osm_buildings (building)
    """)


def main():
    if not CITY:
        print('FATAL: CITY env var is required (e.g. CITY=delhi)', flush=True)
        sys.exit(1)

    bbox = CITY_BBOXES.get(CITY)
    if bbox is None:
        print(f'FATAL: unknown city "{CITY}". Supported: {", ".join(CITY_BBOXES.keys())}', flush=True)
        sys.exit(1)

    if not os.path.exists(PBF_PATH):
        print(f'FATAL: PBF file not found at {PBF_PATH}', flush=True)
        sys.exit(1)

    print(f'Connecting to PostGIS at {DB_CONFIG["host"]}:{DB_CONFIG["port"]}...', flush=True)
    conn = psycopg2.connect(**DB_CONFIG)
    cursor = conn.cursor()

    print('Ensuring osm_buildings schema...', flush=True)
    ensure_schema(cursor)
    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM osm_buildings WHERE source_city = %s", (CITY,))
    existing = cursor.fetchone()[0]
    if existing > 0:
        if FORCE_REIMPORT:
            print(f'FORCE_REIMPORT=true — deleting {existing} rows for city={CITY}', flush=True)
            cursor.execute("DELETE FROM osm_buildings WHERE source_city = %s", (CITY,))
            conn.commit()
        else:
            print(f'osm_buildings already has {existing} rows for city={CITY} — skipping. Set FORCE_REIMPORT=true to reimport.', flush=True)
            cursor.close()
            conn.close()
            return

    print(f'Processing {PBF_PATH} for city={CITY} bbox={bbox} ...', flush=True)
    handler = BuildingHandler(conn, cursor, bbox)
    handler.apply_file(PBF_PATH, locations=True)
    handler.flush()

    elapsed = time.time() - handler.start_time
    print(f'\nDone! Imported {handler.count} buildings for {CITY} in {elapsed:.0f}s', flush=True)

    cursor.execute("SELECT COUNT(*) FROM osm_buildings WHERE source_city = %s", (CITY,))
    final_count = cursor.fetchone()[0]
    print(f'  total in DB for {CITY}: {final_count}', flush=True)

    cursor.close()
    conn.close()


if __name__ == '__main__':
    main()
