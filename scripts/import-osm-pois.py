#!/usr/bin/env python3
"""Import POIs (amenity/shop/tourism/railway/highway/place) from India OSM PBF into PostGIS osm_pois.

Handles nodes (direct lat/lng) and ways (centroid from node locations).
Skips relations.
Only imports named POIs.

Usage:
    python scripts/import-osm-pois.py
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

AMENITY_VALUES = frozenset({
    'hospital', 'clinic', 'school', 'college', 'university',
    'fuel', 'restaurant', 'cafe', 'bank', 'atm', 'police', 'bus_station',
})
SHOP_VALUES = frozenset({
    'mall', 'supermarket', 'convenience', 'department_store', 'marketplace',
})
TOURISM_VALUES = frozenset({
    'attraction', 'hotel', 'museum', 'viewpoint',
})
RAILWAY_VALUES = frozenset({
    'station', 'subway_entrance', 'tram_stop',
})
HIGHWAY_VALUES = frozenset({
    'bus_stop', 'traffic_signals',
})
PLACE_VALUES = frozenset({
    'suburb', 'neighbourhood', 'quarter', 'locality',
})


def categorize_tag(tag_key: str, tag_value: str) -> str:
    if tag_value in ('fuel',):
        return 'fuel'
    if tag_value in ('hospital', 'clinic'):
        return 'hospital'
    if tag_value in ('police',):
        return 'police'
    if tag_value in ('school', 'college', 'university'):
        return 'education'
    if tag_value in ('restaurant', 'cafe'):
        return 'food'
    if tag_value in ('bank', 'atm'):
        return 'bank'
    if tag_value in ('bus_station',):
        return 'transport'
    if tag_value in ('marketplace',):
        return 'market'
    if tag_value in ('mall', 'supermarket', 'department_store'):
        return 'market'
    if tag_value in ('convenience',):
        return 'bank'
    if tag_value in ('attraction', 'museum', 'viewpoint'):
        return 'landmark'
    if tag_value in ('hotel',):
        return 'other'
    if tag_value in ('station', 'subway_entrance', 'tram_stop'):
        return 'transport'
    if tag_value == 'bus_stop':
        return 'transport'
    if tag_value == 'traffic_signals':
        return 'junction'
    if tag_value in ('suburb', 'neighbourhood', 'quarter', 'locality'):
        return 'locality'
    return 'other'


def extract_poi(tags: dict):
    name = tags.get('name')
    if not name:
        return None
    amenity = tags.get('amenity')
    if amenity and amenity in AMENITY_VALUES:
        return (categorize_tag('amenity', amenity), amenity)
    shop = tags.get('shop')
    if shop and shop in SHOP_VALUES:
        return (categorize_tag('shop', shop), shop)
    tourism = tags.get('tourism')
    if tourism and tourism in TOURISM_VALUES:
        return (categorize_tag('tourism', tourism), tourism)
    railway = tags.get('railway')
    if railway and railway in RAILWAY_VALUES:
        return (categorize_tag('railway', railway), railway)
    highway = tags.get('highway')
    if highway and highway in HIGHWAY_VALUES:
        return (categorize_tag('highway', highway), highway)
    place = tags.get('place')
    if place and place in PLACE_VALUES:
        return (categorize_tag('place', place), place)
    return None


class PoiHandler(osmium.SimpleHandler):
    def __init__(self, conn, cursor):
        super().__init__()
        self.conn = conn
        self.cursor = cursor
        self.batch = []
        self.count = 0
        self.start_time = time.time()

    def node(self, n):
        tags = dict(n.tags)
        poi_info = extract_poi(tags)
        if poi_info is None:
            return
        category, poi_type = poi_info
        wkt = f'SRID=4326;POINT({n.lon} {n.lat})'
        self.batch.append((
            f'n{n.id}',
            'node',
            tags.get('name'),
            category,
            poi_type,
            json.dumps(tags, ensure_ascii=False),
            wkt,
        ))
        self._maybe_flush()

    def way(self, w):
        tags = dict(w.tags)
        poi_info = extract_poi(tags)
        if poi_info is None:
            return
        category, poi_type = poi_info
        lats = []
        lngs = []
        for nd in w.nodes:
            if nd.location.valid():
                lats.append(nd.lat)
                lngs.append(nd.lon)
        if not lats:
            return
        avg_lat = sum(lats) / len(lats)
        avg_lon = sum(lngs) / len(lngs)
        wkt = f'SRID=4326;POINT({avg_lon} {avg_lat})'
        self.batch.append((
            f'w{w.id}',
            'way',
            tags.get('name'),
            category,
            poi_type,
            json.dumps(tags, ensure_ascii=False),
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
                """INSERT INTO osm_pois
                   (osm_id, osm_type, name, poi_category, poi_type, tags, geom)
                   VALUES %s
                   ON CONFLICT (osm_type, osm_id) DO NOTHING""",
                self.batch,
                template="(%s, %s, %s, %s, %s, %s::jsonb, ST_GeomFromEWKT(%s))",
            )
            self.conn.commit()
            self.count += len(self.batch)
            elapsed = time.time() - self.start_time
            print(f'  committed {self.count} POIs [{elapsed:.0f}s]', flush=True)
            self.batch = []
        except Exception as e:
            print(f'ERROR during batch insert: {e}', flush=True)
            self.conn.rollback()
            raise


def ensure_schema(cursor):
    cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS osm_pois (
            id          BIGSERIAL PRIMARY KEY,
            osm_id      TEXT,
            osm_type    TEXT,
            name        TEXT NOT NULL,
            poi_category TEXT,
            poi_type    TEXT,
            tags        JSONB,
            geom        geometry(Point, 4326)
        )
    """)
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_osm_pois_unique
        ON osm_pois (osm_type, osm_id)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_osm_pois_geom
        ON osm_pois USING GIST (geom)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_osm_pois_category
        ON osm_pois (poi_category)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_osm_pois_type
        ON osm_pois (poi_type)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_osm_pois_name
        ON osm_pois (name)
    """)


def main():
    if not os.path.exists(PBF_PATH):
        print(f'FATAL: PBF file not found at {PBF_PATH}', flush=True)
        sys.exit(1)

    print(f'Connecting to PostGIS at {DB_CONFIG["host"]}:{DB_CONFIG["port"]}...', flush=True)
    conn = psycopg2.connect(**DB_CONFIG)
    cursor = conn.cursor()

    print('Ensuring osm_pois schema...', flush=True)
    ensure_schema(cursor)
    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM osm_pois")
    existing = cursor.fetchone()[0]
    if existing > 0:
        if FORCE_REIMPORT:
            print(f'FORCE_REIMPORT=true — truncating {existing} rows and reimporting...', flush=True)
            cursor.execute("TRUNCATE osm_pois")
            conn.commit()
        else:
            print(f'osm_pois already has {existing} rows — skipping. Set FORCE_REIMPORT=true to reimport.', flush=True)
            cursor.close()
            conn.close()
            return

    print(f'Processing {PBF_PATH} ...', flush=True)
    handler = PoiHandler(conn, cursor)
    handler.apply_file(PBF_PATH, locations=True)
    handler.flush()

    elapsed = time.time() - handler.start_time
    print(f'\nDone! Imported {handler.count} POIs in {elapsed:.0f}s', flush=True)

    cursor.execute("SELECT COUNT(*) FROM osm_pois")
    final_count = cursor.fetchone()[0]
    print(f'  total in DB: {final_count}', flush=True)

    cursor.execute("""
        SELECT poi_category, COUNT(*) AS cnt
        FROM osm_pois
        GROUP BY poi_category
        ORDER BY cnt DESC
    """)
    rows = cursor.fetchall()
    print('  by category:', flush=True)
    for cat, cnt in rows:
        print(f'    {cat}: {cnt}', flush=True)

    cursor.close()
    conn.close()


if __name__ == '__main__':
    main()
