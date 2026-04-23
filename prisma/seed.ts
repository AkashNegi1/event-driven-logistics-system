import 'dotenv/config';
import {
  OrderStatus,
  PaymentStatus,
  DriverStatus,
  DriverRole,
  AssignmentStatus,
  AssignmentType,
} from '../generated/prisma/client';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding started...");

  // साफ start (dev only)
  await prisma.trackingEvent.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.user.deleteMany();

  // ================= USER =================
  const user = await prisma.user.create({
    data: {
      name: 'Akash',
      email: 'akash@example.com',
      password: 'hashedpassword',
      address: 'Delhi, India',
      phone: '9999999999',
    },
  });

  // ================= DRIVER =================
  const driver = await prisma.driver.create({
    data: {
      name: "Driver One",
      email: "driver1@example.com",
      password: "hashedpassword",
      status: DriverStatus.ASSIGNED,
      role: DriverRole.DELIVERY,
      lat: 28.6139,
      lng: 77.2090,
    },
  });

  // ================= ORDER =================
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      status: OrderStatus.OUT_FOR_DELIVERY,
      paymentStatus: PaymentStatus.PAID,
      pickupLat: 28.6100,
      pickupLng: 77.2000,
      deliveryLat: 28.6300,
      deliveryLng: 77.2200,
    },
  });

  // ================= ASSIGNMENT =================
  const assignment = await prisma.assignment.create({
    data: {
      orderId: order.id,
      driverId: driver.id,
      type: AssignmentType.DELIVERY,
      status: AssignmentStatus.ASSIGNED,
    },
  });

  // ================= TRACKING EVENTS =================
  // simulate movement (like driver traveling)
  const baseLat = 28.6100;
  const baseLng = 77.2000;

  const trackingData = [];

  for (let i = 0; i < 10; i++) {
    trackingData.push({
      orderId: order.id,
      driverId: driver.id,
      lat: baseLat + i * 0.002,
      lng: baseLng + i * 0.002,
    });
  }

  await prisma.trackingEvent.createMany({
    data: trackingData,
  });

  console.log("✅ Seeding completed");
  console.log({
    user,
    driver,
    order,
    assignment,
    trackingPoints: trackingData.length,
  });
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });