# Real-Time Logistics Tracking Backend

A production-grade backend for a real-time logistics tracking platform built with **NestJS**, **TypeScript**, **PostgreSQL**, **Prisma**, **Redis**, **Socket.IO**, **PostGIS**, and **OSRM**.

This backend powers a 3D logistics dashboard with live shipment tracking, demo orders, real-time driver updates, OSM-powered map APIs, route overview context, local city map data, and recruiter-friendly public demo flows.

---

## Table of Contents

1. [Overview](#overview)
2. [Why This Project Exists](#why-this-project-exists)
3. [Core Features](#core-features)
4. [Tech Stack](#tech-stack)
5. [High-Level Architecture](#high-level-architecture)
6. [Backend Modules](#backend-modules)
7. [Demo and Recruiter Flow](#demo-and-recruiter-flow)
8. [Real-Time Tracking Flow](#real-time-tracking-flow)
9. [Map and OSM Pipeline](#map-and-osm-pipeline)
10. [Route Overview APIs](#route-overview-apis)
11. [Truck Local Map APIs](#truck-local-map-apis)
12. [OSRM Routing](#osrm-routing)
13. [Redis Usage](#redis-usage)
14. [Security Model](#security-model)
15. [API Reference](#api-reference)
16. [Environment Variables](#environment-variables)
17. [Local Development Setup](#local-development-setup)
18. [Database Setup](#database-setup)
19. [OSM Data Setup](#osm-data-setup)
20. [Build and Run](#build-and-run)
21. [Deployment Plan](#deployment-plan)
22. [Health Checks](#health-checks)
23. [Recruiter Demo Checklist](#recruiter-demo-checklist)
24. [Project Status](#project-status)
25. [Future Improvements](#future-improvements)
26. [Author](#author)

---

## Overview

The **Real-Time Logistics Tracking Backend** is the core API, real-time engine, map-data provider, and demo orchestration layer for a 3D logistics tracking platform.

It handles:

- order and shipment tracking
- driver assignment
- route planning
- real-time driver location updates
- demo order creation
- public demo-only tracking
- protected real tracking
- local OSM map data
- PostGIS-powered roads, places, POIs, and buildings
- route overview roads and labels
- Redis caching and pub/sub
- OSRM route calculation

The backend is designed to support a recruiter-facing demo where a user can open the frontend, click **Use Demo Order**, see a real route, view nearby map context, open a 3D local city view, and manually start or stop a live delivery simulator.

---

## Why This Project Exists

Most logistics tracking demos only show a simple 2D map, a static marker, or a basic order status page.

This project was built to demonstrate a more realistic logistics platform where multiple backend systems work together:

- REST APIs for order and shipment data
- Socket.IO for live tracking
- Redis for cache and real-time support
- PostgreSQL for application data
- PostGIS for real map data
- OSRM for routing
- public demo endpoints for recruiter evaluation
- protected real tracking endpoints for real users

The goal is to demonstrate backend engineering, real-time systems, geospatial querying, API design, production deployment thinking, and full-stack system integration.

---

## Core Features

### 1. Shipment and Order Tracking

The backend supports order and shipment tracking with:

- order IDs
- pickup location
- destination location
- shipment status
- assigned driver
- tracking events
- current location
- planned route
- live updates

The platform separates planned route data from live tracking data, so unassigned orders can still show a planned route without faking a live truck.

---

### 2. Real-Time Driver Location Updates

The backend uses Socket.IO for real-time location updates.

Key behaviors:

- clients connect with an `orderId`
- each order gets its own Socket.IO room
- driver updates are emitted only to relevant order rooms
- frontend receives `locationUpdate` events
- frontend can show live movement when a driver/simulator is active

---

### 3. Public Demo Flow

The backend includes public demo routes specifically for recruiter demos.

Demo routes allow:

- listing demo orders
- creating/fetching a predefined demo order
- creating a custom demo order
- fetching demo-only tracking data
- manually starting/stopping simulator when enabled

Demo tracking is public, but only for demo-owned orders.

Real tracking remains protected.

---

### 4. Protected Real Tracking Flow

Real tracking endpoints are protected and should not be publicly accessible without authentication.

The public demo flow does not expose real user tracking.

---

### 5. OSM-Powered Map APIs

The backend uses a separate PostGIS database for OSM-derived data.

Expected OSM tables:

    osm_roads
    osm_places
    osm_pois
    osm_buildings

These tables power:

- Route Overview road layer
- Route Overview nearby labels
- Truck Local real roads
- Truck Local POIs
- Truck Local buildings
- route-context locality labels
- OSM health diagnostics

---

### 6. Route Overview Map Context

Route Overview uses bbox-based APIs that return real map context for the visible command-map surface.

These APIs are separate from the local map endpoint.

Route Overview APIs:

- `/map/overview/roads`
- `/map/overview/places`

They are designed for a high-level logistics command map, not a street-level city view.

---

### 7. Truck Local Map Context

Truck Local uses the `/map/local` endpoint to load detailed nearby map data.

This includes:

- local roads
- buildings
- POIs
- places
- local OSM source diagnostics
- Overpass fallback where local data is unavailable

Truck Local is meant to feel like a living local city around the delivery route.

---

### 8. OSRM Route Calculation

The backend uses OSRM for route calculation.

`OSRM_URL` is environment-driven, so the backend can use either:

- public OSRM during development
- self-hosted OSRM in production

Example:

    OSRM_URL=https://router.project-osrm.org

or:

    OSRM_URL=http://osrm:5000

If OSRM fails, the backend keeps fallback behavior so the demo does not completely break.

---

## Tech Stack

| Area | Technology |
|---|---|
| Framework | NestJS |
| Language | TypeScript |
| Runtime | Node.js |
| App Database | PostgreSQL |
| ORM | Prisma |
| Map Database | PostgreSQL + PostGIS |
| Cache / PubSub | Redis |
| Real-Time | Socket.IO |
| Routing | OSRM |
| Validation | NestJS ValidationPipe |
| Deployment Target | AWS EC2 |
| Containerization | Docker / Docker Compose |
| Reverse Proxy | Nginx |

---

## High-Level Architecture
```mermaid
flowchart TB
    %% =======================
    %% USER / CLIENT LAYER
    %% =======================
    subgraph Client["🧑‍💻 Client Layer"]
        User["User / Recruiter"]
        Browser["Vercel Frontend<br/>React + TypeScript + Three.js/R3F"]
        UI1["Route Overview<br/>Command Map View"]
        UI2["Truck Local<br/>3D Local City View"]
        UI3["Create & Track Demo Order"]
        UI4["Use Demo Order"]

        User --> Browser
        Browser --> UI1
        Browser --> UI2
        Browser --> UI3
        Browser --> UI4
    end

    %% =======================
    %% DEPLOYMENT / EDGE
    %% =======================
    subgraph Edge["🌐 Deployment / Edge"]
        Vercel["Vercel<br/>Frontend Hosting"]
        Nginx["Nginx Reverse Proxy<br/>HTTPS + WebSocket Upgrade"]
        SSL["Let's Encrypt SSL<br/>sslip.io HTTPS"]
    end

    Browser -->|HTTPS REST API| Nginx
    Browser -->|Socket.IO WebSocket| Nginx
    Vercel -. hosts .-> Browser
    SSL -. certs .-> Nginx

    %% =======================
    %% BACKEND
    %% =======================
    subgraph Backend["🚀 AWS EC2 Backend Stack"]
        Nest["NestJS Backend<br/>TypeScript"]
        DemoModule["Demo Module<br/>Shared Demo + Custom Demo Orders"]
        TrackingModule["Tracking Module<br/>Order Tracking + Simulator"]
        MapModule["Map Module<br/>Route Context + Local Map APIs"]
        Gateway["Socket.IO Gateway<br/>Order Rooms"]
        Prisma["Prisma ORM"]
    end

    Nginx -->|Proxy HTTP| Nest
    Nginx -->|Proxy /socket.io| Gateway

    Nest --> DemoModule
    Nest --> TrackingModule
    Nest --> MapModule
    Nest --> Prisma
    TrackingModule --> Gateway

    %% =======================
    %% DATA LAYER
    %% =======================
    subgraph Data["🗄️ Data Layer"]
        Postgres["PostgreSQL<br/>Users, Orders, Drivers, Assignments, Tracking Events"]
        PostGIS["PostGIS OSM Database<br/>osm_roads, osm_places, osm_pois, osm_buildings"]
        Redis["Redis<br/>Live location cache + Pub/Sub"]
    end

    Prisma --> Postgres
    MapModule --> PostGIS
    TrackingModule --> Redis
    Gateway --> Redis

    %% =======================
    %% EXTERNAL MAP / ROUTING
    %% =======================
    subgraph External["🗺️ External / Fallback Services"]
        OSRM["OSRM Public Router<br/>Route Geometry"]
        Overpass["Overpass API<br/>Fallback OSM Data"]
    end

    MapModule -->|Fetch route geometry| OSRM
    MapModule -. fallback only .-> Overpass

    %% =======================
    %% REAL-TIME TRACKING FLOW
    %% =======================
    subgraph Realtime["⚡ Real-Time Flow"]
        Simulator["Demo Simulator<br/>Driver Location Generator"]
        DriverLocation["Driver Location Update"]
        OrderRoom["Socket.IO Room<br/>room: orderId"]
        LiveUpdate["locationUpdate Event"]
    end

    TrackingModule --> Simulator
    Simulator --> DriverLocation
    DriverLocation --> Redis
    Redis --> Gateway
    Gateway --> OrderRoom
    OrderRoom --> LiveUpdate
    LiveUpdate --> Browser

    %% =======================
    %% DEMO FLOWS
    %% =======================
    subgraph DemoFlows["🎮 Demo Modes"]
        SharedDemo["Use Demo Order<br/>Shared recruiter demo<br/>View-only by default"]
        CustomDemo["Create & Track Demo Order<br/>Unique demo order + unique demo driver"]
        AdminDemo["?adminDemo=true<br/>Private simulator control"]
    end

    UI4 --> SharedDemo
    UI3 --> CustomDemo
    Browser -. private control .-> AdminDemo

    SharedDemo --> DemoModule
    CustomDemo --> DemoModule
    AdminDemo --> TrackingModule

    DemoModule -->|Create/Fetch Demo Order| Postgres
    DemoModule -->|Assign Demo Driver| Postgres
    TrackingModule -->|Start / Stop Simulator| Simulator

    %% =======================
    %% FRONTEND STATE / RENDERING
    %% =======================
    subgraph FrontendState["🎨 Frontend State + 3D Rendering"]
        Zustand["Zustand Stores<br/>trackingStore, routeStore, localMapStore"]
        RouteContext["Route Context Loader"]
        LocalMap["Local Map Loader<br/>roads/buildings/POIs"]
        FallbackBuildings["Procedural Fallback Buildings<br/>Frontend-only"]
        ThreeScene["Three.js Scene<br/>Truck, Roads, Buildings, Route"]
    end

    Browser --> Zustand
    Zustand --> RouteContext
    Zustand --> LocalMap
    LocalMap --> FallbackBuildings
    RouteContext --> ThreeScene
    LocalMap --> ThreeScene
    FallbackBuildings --> ThreeScene
    ThreeScene --> UI1
    ThreeScene --> UI2

    %% =======================
    %% API ROUTES
    %% =======================
    subgraph APIs["🔌 Key API Endpoints"]
        API1["POST /demo/order"]
        API2["GET /demo/orders"]
        API3["GET /demo/tracking/:orderId"]
        API4["POST /tracking/:orderId/simulator/start"]
        API5["POST /tracking/:orderId/simulator/stop"]
        API6["POST /map/route-context"]
        API7["GET /map/local"]
        API8["GET /map/osm/health"]
        API9["GET /health"]
    end

    Browser --> API1
    Browser --> API2
    Browser --> API3
    Browser --> API4
    Browser --> API5
    Browser --> API6
    Browser --> API7
    Browser --> API8
    Browser --> API9

    API1 --> Nest
    API2 --> Nest
    API3 --> Nest
    API4 --> Nest
    API5 --> Nest
    API6 --> Nest
    API7 --> Nest
    API8 --> Nest
    API9 --> Nest

    %% =======================
    %% STYLING
    %% =======================
    classDef client fill:#dbeafe,stroke:#2563eb,color:#111827;
    classDef backend fill:#dcfce7,stroke:#16a34a,color:#111827;
    classDef data fill:#fef3c7,stroke:#d97706,color:#111827;
    classDef external fill:#fee2e2,stroke:#dc2626,color:#111827;
    classDef realtime fill:#ede9fe,stroke:#7c3aed,color:#111827;
    classDef deploy fill:#e0f2fe,stroke:#0284c7,color:#111827;
    classDef api fill:#f3f4f6,stroke:#4b5563,color:#111827;

    class User,Browser,UI1,UI2,UI3,UI4,Zustand,RouteContext,LocalMap,FallbackBuildings,ThreeScene client;
    class Nest,DemoModule,TrackingModule,MapModule,Gateway,Prisma backend;
    class Postgres,PostGIS,Redis data;
    class OSRM,Overpass external;
    class Simulator,DriverLocation,OrderRoom,LiveUpdate realtime;
    class Vercel,Nginx,SSL deploy;
    class API1,API2,API3,API4,API5,API6,API7,API8,API9 api;
``` 
---

## Backend Modules

### Auth Module

Handles authentication and JWT-based route protection.

Used for real user tracking and protected routes.

---

### Demo Module

Handles public recruiter-friendly demo flows.

Responsibilities:

- list demo orders
- create/fetch predefined demo orders
- create custom demo orders
- return demo-only tracking data
- reject non-demo orders from public demo tracking

---

### Tracking Module

Handles shipment tracking and real-time delivery state.

Responsibilities:

- fetch tracking details
- emit live location updates
- manage simulator start/stop
- handle mock location updates when enabled
- coordinate route progress
- integrate with Socket.IO gateway

---

### Driver Module

Handles driver-related operations.

Responsibilities:

- driver updates
- driver location flow
- assignment-related behavior
- simulator-related driver movement support

---

### Map Module

Handles map and OSM-related APIs.

Responsibilities:

- OSM health checks
- local map data
- route context
- overview roads
- overview places
- PostGIS queries
- Overpass fallback for selected local endpoints

---

### Redis Module

Handles Redis connections and cache/pub-sub usage.

Responsibilities:

- map cache
- route-context cache
- local-map cache
- real-time support
- graceful Redis shutdown

---

## Demo and Recruiter Flow

The demo flow is designed so a recruiter can use the platform without creating an account.

Expected demo flow:

    1. Recruiter opens frontend
    2. Clicks "Use Demo Order"
    3. Frontend calls demo endpoint
    4. Backend creates or returns a demo order
    5. Frontend loads demo tracking data
    6. Route Overview renders route and map context
    7. Truck Local renders local city context
    8. Simulator starts only when manually clicked
    9. Simulator stops when manually clicked

Important rules:

- demo tracking is public
- demo tracking must only return demo-owned orders
- real `/tracking/:orderId` remains protected
- simulator must not auto-start
- unassigned orders must not show fake live truck

---

## Real-Time Tracking Flow

    Client connects with orderId
            |
            v
    Socket.IO Gateway validates orderId
            |
            v
    Client joins order-specific room
            |
            v
    Driver/simulator emits location update
            |
            v
    Backend processes update
            |
            v
    Backend emits locationUpdate to order room
            |
            v
    Frontend updates target truck position
            |
            v
    Frontend interpolates smooth visual movement

The backend sends discrete updates. The frontend smooths the movement visually.

---

## Map and OSM Pipeline

The backend uses a separate PostGIS database for OSM data.

Expected tables:

    osm_roads
    osm_places
    osm_pois
    osm_buildings

### Table Usage

| Table | Purpose |
|---|---|
| `osm_roads` | Truck Local roads and Route Overview roads |
| `osm_places` | route context and nearby overview labels |
| `osm_pois` | Truck Local POIs |
| `osm_buildings` | Truck Local 3D buildings |

### OSM Data Sources

The OSM database is expected to be imported from `.osm.pbf` files.

For recruiter deployment, it is recommended to import only the needed demo regions instead of full India:

    Delhi/NCR
    Chandigarh/Mohali/Kharar
    selected long-route corridor if needed

This keeps the deployment smaller, faster, and cheaper.

---

## Route Overview APIs

Route Overview is a high-level logistics command-map view.

It should not render a full 3D city. It only needs subtle real-world context.

### `/map/overview/roads`

Returns bbox-based road data for the visible overview surface.

Used for:

- subtle real road layer
- regional map context
- local map context
- command-map background detail

Expected behavior:

- query roads by bbox
- return GeoJSON FeatureCollection
- support local/regional mode if implemented
- keep response capped
- simplify geometry where safe
- avoid returning too much street-level clutter for long routes

---

### `/map/overview/places`

Returns bbox-based nearby place labels for Route Overview.

Used for:

- nearby locality labels
- major area labels
- city/town labels for long routes
- subtle map annotations

Expected behavior:

- query places by bbox
- return useful named places
- avoid tiny POI clutter
- deduplicate names
- rank by place importance/type
- return limited number of labels

---

## Truck Local Map APIs

### `/map/local`

Returns detailed local map data around a given location.

Used for the Truck Local 3D city view.

It can return:

- roads
- POIs
- buildings
- places
- local OSM source diagnostics

Truck Local is a close-range city view, so it needs more detail than Route Overview.

---

## OSRM Routing

The backend uses OSRM for route calculation.

Environment variable:

    OSRM_URL=https://router.project-osrm.org

For local development, public OSRM can be used.

For production, a self-hosted OSRM container is recommended if reliability is required.

Example production value:

    OSRM_URL=http://osrm:5000

The service should keep fallback behavior so a temporary OSRM failure does not completely break the demo.

---

## Redis Usage

Redis is used for:

- route-context cache
- local-map cache
- pub/sub support
- tracking support
- simulator-related state
- performance optimization

Environment variable:

    REDIS_URL=redis://localhost:6379

In production, Redis should run as a container or managed service.

---

## Security Model

### Public Demo Routes

Demo routes are public but restricted to demo-owned orders.

Examples:

- `/demo/orders`
- `/demo/order`
- `/demo/order/create`
- `/demo/tracking/:orderId`

### Protected Real Routes

Real tracking routes remain protected.

Example:

- `/tracking/:orderId`

### Simulator Safety

Simulator and mock endpoints are gated by:

    ENABLE_TRACKING_SIMULATOR=true

In production, simulator controls should be restricted to demo orders.

### CORS

HTTP and Socket.IO CORS are controlled by:

    CORS_ORIGINS=http://localhost:5173

In production:

    CORS_ORIGINS=https://your-frontend.vercel.app

Do not use wildcard CORS in production.

---

## API Reference

### Demo APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/demo/orders` | List available demo orders |
| POST | `/demo/order` | Create or fetch predefined demo order |
| POST | `/demo/order/create` | Create custom demo order |
| GET | `/demo/tracking/:orderId` | Fetch demo-only tracking data |

---

### Tracking APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/tracking/:orderId` | Protected real tracking endpoint |
| POST | `/tracking/:orderId/mock-location` | Mock location update endpoint |
| POST | `/tracking/:orderId/simulator/start` | Start delivery simulator |
| POST | `/tracking/:orderId/simulator/stop` | Stop delivery simulator |

---

### Map APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/map/osm/health` | Check PostGIS OSM DB health |
| GET | `/map/local` | Fetch detailed local map data |
| POST | `/map/route-context` | Fetch places along route corridor |
| GET | `/map/overview/roads` | Fetch bbox-based overview roads |
| GET | `/map/overview/places` | Fetch bbox-based overview places |

---

## Environment Variables

Create `.env` from `.env.example`.

    NODE_ENV=development
    PORT=3000

    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/logistics_app

    OSM_DATABASE_URL=postgresql://osm:osm@localhost:5433/osm_india

    REDIS_URL=redis://localhost:6379

    JWT_SECRET=replace_with_secure_random_secret

    CORS_ORIGINS=http://localhost:5173

    OSRM_URL=https://router.project-osrm.org

    ENABLE_TRACKING_SIMULATOR=false

For local simulator testing:

    ENABLE_TRACKING_SIMULATOR=true

For production:

    NODE_ENV=production
    CORS_ORIGINS=https://your-frontend.vercel.app
    JWT_SECRET=strong_random_secret
    ENABLE_TRACKING_SIMULATOR=true

Only enable simulator in production if demo simulator controls are required.

---

## Local Development Setup

### 1. Install Dependencies

    npm install

### 2. Start Local Infrastructure

If Docker Compose is configured for local dependencies:

    docker compose up -d

Expected services:

- PostgreSQL app database
- PostGIS OSM database
- Redis

### 3. Generate Prisma Client

    npx prisma generate

### 4. Run Migrations

    npx prisma migrate dev

### 5. Seed Demo Data

    npm run seed

### 6. Start Backend

    npm run start:dev

Backend runs at:

    http://localhost:3000

---

## Database Setup

The app database uses PostgreSQL with Prisma.

Main responsibilities:

- users
- drivers
- orders
- shipments
- tracking events
- assignments
- demo data

Common commands:

    npx prisma generate
    npx prisma migrate dev
    npx prisma migrate deploy
    npm run seed

For production deployment:

    npx prisma migrate deploy

---

## OSM Data Setup

The OSM/PostGIS database is separate from the app database.

Required tables:

    osm_roads
    osm_places
    osm_pois
    osm_buildings

For local development, these can be imported using project import scripts.

For production demo, import only required demo areas to keep infrastructure lightweight.

Recommended demo data regions:

    Delhi/NCR
    Chandigarh/Mohali/Kharar
    selected long-route corridor

---

## Build and Run

### Build

    npm run build

### Run Compiled Server

    node dist/main.js

### Development

    npm run start:dev

---

## Deployment Plan

Recommended deployment architecture:

    Frontend: Vercel
    Backend: AWS EC2
    Reverse Proxy: Nginx
    Runtime: Docker Compose
    App DB: PostgreSQL container
    Map DB: PostGIS container
    Cache: Redis container
    Routing: Public OSRM or self-hosted OSRM

Expected public request flow:

    https://frontend.vercel.app
            |
            v
    https://api.yourdomain.com
            |
            v
    Nginx
            |
            v
    NestJS backend :3000

Nginx must support WebSocket upgrade headers for Socket.IO.

---

## Health Checks

After starting the backend, verify:

    GET /map/osm/health
    GET /demo/orders
    POST /demo/order
    GET /demo/tracking/:orderId
    GET /map/overview/roads
    GET /map/overview/places
    GET /map/local

Also verify Socket.IO connection with an `orderId`.

---

## Recruiter Demo Checklist

Before sharing the live project:

- Use Demo Order works
- Route Overview loads
- Real route appears
- Route Overview roads appear
- Route Overview nearby labels appear
- Truck Local loads
- Local roads/buildings/POIs load
- Simulator does not auto-start
- Start Simulator works
- Stop Simulator works
- Real tracking remains protected
- Demo tracking remains public and demo-only
- Socket.IO connects correctly
- No CORS errors
- No Canvas crash on frontend

---

## Project Status

Current status:

- Backend build passes
- Demo order flow works
- Real tracking route remains protected
- Socket.IO live tracking works
- OSRM URL is environment-driven
- Route Overview roads API exists
- Route Overview places API exists
- Truck Local uses local OSM data
- PostGIS map pipeline is integrated
- Deployment hardening completed
- Docker/Nginx production setup pending

---

## Future Improvements

Possible next improvements:

- backend Dockerfile
- production Docker Compose
- Nginx reverse proxy config
- self-hosted OSRM
- OSM import automation for production
- rate limiting
- Helmet/security middleware
- better deployment health endpoint
- CI/CD pipeline
- API documentation with Swagger
- automated demo seed validation

---

## Author

**Akash Negi**

- GitHub: [AkashNegi1](https://github.com/AkashNegi1)
- LinkedIn: [Akash Negi](https://www.linkedin.com/in/akash-negi-67a713153/)