# Event Driven Logistics System

- PostgreSQL + Prisma
- Redis (Pub/Sub)
- Docker Compose setup

## Setup

docker-compose up -d
npx prisma migrate dev

## Architecture

User → API → Postgres  
Driver → Redis Pub/Sub → WebSocket → User