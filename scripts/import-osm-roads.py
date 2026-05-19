#!/usr/bin/env python3
"""Import highway=* ways from India OSM PBF into PostGIS osm_roads table.

Handles ways only. LineString geometry from node coordinates.
Skips relations.

Usage:
    python scripts/import-osm-roads.py
"""

import os
import sys
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
FORCE_REIMPORT = os.environ.get('FORCE_REIMPORT', '').lower() in ('true', '1', 'yes')
BATCH_SIZE = 2000

ALLOWED_HIGHWAYS = frozenset({
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'residential', 'service', 'unclassified',
})


class RoadHandler(osmium.SimpleHandler):
    def __init__(self, conn, cursor):
        super().__init__()
        self.conn = conn
        self.cursor = cursor
        self.batch = []
        self.count = 0
        self.start_time = time.time()

    def way(self, w):
        tags = dict(w.tags)
        highway = tags.get('highway')
        if highway is None or highway not in ALLOWED_HIGHWAYS:
            return

        coords = [(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
        if len(coords) < 2:
            return

        wkt = self._build_multilinestring_wkt(coords)

        self.batch.append((
            f'w{w.id}',
            tags.get('name'),
            highway,
            tags.get('surface'),
            tags.get('oneway', 'no') == 'yes',
            tags.get('bridge'),
            tags.get('tunnel'),
            json.dumps(tags, ensure_ascii=False),
            wkt,
        ))
        self._maybe_flush()

    def _build_multilinestring_wkt(self, coords):
        pts = ', '.join(f'{lon} {lat}' for lon, lat in coords)
        return f'SRID=4326;MULTILINESTRING(({pts}))'

    def _maybe_flush(self):
        if len(self.batch) >= BATCH_SIZE:
            self.flush()

    def flush(self):
        if not self.batch:
            return
        try:
            execute_values(
                self.cursor,
                """INSERT INTO osm_roads
                   (osm_id, name, highway, surface, oneway, bridge, tunnel, tags, geom)
                   VALUES %s
                   ON CONFLICT (osm_id) DO NOTHING""",
                self.batch,
                template="(%s, %s, %s, %s, %s, %s, %s, %s::jsonb, ST_GeomFromEWKT(%s))",
            )
            self.conn.commit()
            self.count += len(self.batch)
            elapsed = time.time() - self.start_time
            print(f'  committed {self.count} roads [{elapsed:.0f}s]', flush=True)
            self.batch = []
        except Exception as e:
            print(f'ERROR during batch insert: {e}', flush=True)
            self.conn.rollback()
            raise


def ensure_schema(cursor):
    cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS osm_roads (
            id        BIGSERIAL PRIMARY KEY,
            osm_id    TEXT UNIQUE,
            name      TEXT,
            highway   TEXT,
            surface   TEXT,
            oneway    BOOLEAN,
            bridge    TEXT,
            tunnel    TEXT,
            tags      JSONB,
            geom      GEOMETRY(MultiLineString, 4326)
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_osm_roads_geom    ON osm_roads USING GIST (geom)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_osm_roads_highway ON osm_roads (highway)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_osm_roads_name    ON osm_roads (name)")


def main():
    if not os.path.exists(PBF_PATH):
        print(f'FATAL: PBF file not found at {PBF_PATH}', flush=True)
        sys.exit(1)

    print(f'Connecting to PostGIS at {DB_CONFIG["host"]}:{DB_CONFIG["port"]}...', flush=True)
    conn = psycopg2.connect(**DB_CONFIG)
    cursor = conn.cursor()

    print('Ensuring osm_roads schema...', flush=True)
    ensure_schema(cursor)
    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM osm_roads")
    existing = cursor.fetchone()[0]
    if existing > 0:
        if FORCE_REIMPORT:
            print(f'FORCE_REIMPORT=true — truncating {existing} rows and reimporting...', flush=True)
            cursor.execute("TRUNCATE osm_roads")
            conn.commit()
        else:
            print(f'osm_roads already has {existing} rows — skipping. Set FORCE_REIMPORT=true to reimport.', flush=True)
            cursor.close()
            conn.close()
            return

    print(f'Processing {PBF_PATH} ...', flush=True)
    handler = RoadHandler(conn, cursor)
    handler.apply_file(PBF_PATH, locations=True)
    handler.flush()

    elapsed = time.time() - handler.start_time
    print(f'\nDone! Imported {handler.count} roads in {elapsed:.0f}s', flush=True)

    cursor.execute("SELECT COUNT(*) FROM osm_roads")
    final_count = cursor.fetchone()[0]
    print(f'  total in DB: {final_count}', flush=True)

    cursor.close()
    conn.close()


if __name__ == '__main__':
    main()
