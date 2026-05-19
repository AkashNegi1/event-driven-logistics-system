#!/usr/bin/env python3
"""Import only place=* objects from India OSM PBF into PostGIS osm_places table.

Handles nodes (lat/lon), ways (centroid of node locations),
and relations (centroid of member node locations).

Usage:
    python scripts/import-osm-places.py
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

ALLOWED_PLACE_TYPES = frozenset({
    'city', 'town', 'suburb', 'neighbourhood',
    'quarter', 'locality', 'village',
})


class PlaceCollector(osmium.SimpleHandler):
    def __init__(self, conn, cursor):
        super().__init__()
        self.conn = conn
        self.cursor = cursor
        self.batch = []
        self.node_count = 0
        self.way_count = 0
        self.rel_count = 0
        self.start_time = time.time()

    def node(self, n):
        tags = dict(n.tags)
        place = tags.get('place')
        if place is not None and place in ALLOWED_PLACE_TYPES and n.location.valid():
            self.batch.append((
                f'n{n.id}',
                'node',
                tags.get('name', ''),
                place,
                tags.get('is_in:state') or tags.get('addr:state'),
                json.dumps(tags, ensure_ascii=False),
                f'SRID=4326;POINT({n.location.lon} {n.location.lat})',
            ))
            self.node_count += 1
            self._maybe_flush()

    def way(self, w):
        tags = dict(w.tags)
        place = tags.get('place')
        if place is not None and place in ALLOWED_PLACE_TYPES:
            coords = [(nd.lon, nd.lat) for nd in w.nodes if nd.location.valid()]
            if coords:
                lon = sum(c[0] for c in coords) / len(coords)
                lat = sum(c[1] for c in coords) / len(coords)
                self.batch.append((
                    f'w{w.id}',
                    'way',
                    tags.get('name', ''),
                    place,
                    tags.get('is_in:state') or tags.get('addr:state'),
                    json.dumps(tags, ensure_ascii=False),
                    f'SRID=4326;POINT({lon} {lat})',
                ))
                self.way_count += 1
                self._maybe_flush()

    # Relation processing disabled for now (RelationMember has no .location attribute).
    # def relation(self, r): ...

    def _maybe_flush(self):
        if len(self.batch) >= BATCH_SIZE:
            self.flush()

    def flush(self):
        if not self.batch:
            return
        try:
            execute_values(
                self.cursor,
                """INSERT INTO osm_places
                   (osm_id, osm_type, name, place_type, state, tags, geom)
                   VALUES %s
                   ON CONFLICT (osm_type, osm_id) DO NOTHING""",
                self.batch,
                template="(%s, %s, %s, %s, %s, %s::jsonb, ST_GeomFromEWKT(%s))",
            )
            self.conn.commit()
            elapsed = time.time() - self.start_time
            total = self.node_count + self.way_count + self.rel_count
            print(
                f'  committed {total} places '
                f'(nodes={self.node_count} ways={self.way_count} rels={self.rel_count}) '
                f'[{elapsed:.0f}s]',
                flush=True,
            )
            self.batch = []
        except Exception as e:
            print(f'ERROR during batch insert: {e}', flush=True)
            self.conn.rollback()
            raise


def ensure_schema(cursor):
    cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS osm_places (
            id          BIGSERIAL PRIMARY KEY,
            osm_id      TEXT,
            osm_type    TEXT,
            name        TEXT NOT NULL,
            place_type  TEXT,
            state       TEXT,
            tags        JSONB,
            geom        GEOMETRY(Point, 4326)
        )
    """)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_osm_places_geom       ON osm_places USING GIST (geom)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_osm_places_place_type ON osm_places (place_type)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_osm_places_name       ON osm_places (name)"
    )
    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_osm_places_unique_osm ON osm_places (osm_type, osm_id)"
    )


def main():
    if not os.path.exists(PBF_PATH):
        print(f'FATAL: PBF file not found at {PBF_PATH}', flush=True)
        sys.exit(1)

    print(f'Connecting to PostGIS at {DB_CONFIG["host"]}:{DB_CONFIG["port"]}...', flush=True)
    conn = psycopg2.connect(**DB_CONFIG)
    cursor = conn.cursor()

    print('Ensuring osm_places schema...', flush=True)
    ensure_schema(cursor)
    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM osm_places")
    existing = cursor.fetchone()[0]
    if existing > 0:
        if FORCE_REIMPORT:
            print(f'FORCE_REIMPORT=true — truncating {existing} rows and reimporting...', flush=True)
            cursor.execute("TRUNCATE osm_places")
            conn.commit()
        else:
            print(f'osm_places already has {existing} rows — skipping import. Set FORCE_REIMPORT=true to reimport.', flush=True)
            cursor.close()
            conn.close()
            return

    print(f'Processing {PBF_PATH} ...', flush=True)
    handler = PlaceCollector(conn, cursor)
    handler.apply_file(PBF_PATH, locations=True)
    handler.flush()

    total = handler.node_count + handler.way_count + handler.rel_count
    elapsed = time.time() - handler.start_time
    print(f'\nDone! Imported {total} places in {elapsed:.0f}s', flush=True)
    print(f'  nodes:    {handler.node_count}', flush=True)
    print(f'  ways:     {handler.way_count}', flush=True)
    print(f'  rels:     {handler.rel_count}', flush=True)

    cursor.execute("SELECT COUNT(*) FROM osm_places")
    final_count = cursor.fetchone()[0]
    print(f'  total in DB: {final_count}', flush=True)

    cursor.close()
    conn.close()


if __name__ == '__main__':
    main()
