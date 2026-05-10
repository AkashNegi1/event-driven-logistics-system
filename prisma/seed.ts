import 'dotenv/config';
import {
  OrderStatus,
  PaymentStatus,
  DriverStatus,
  DriverRole,
  AssignmentStatus,
  AssignmentType,
} from '../generated/prisma/client.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding started...');

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
      lat: 28.6139,
      lng: 77.209,
    },
  });

  // ================= DRIVER =================
  const driver = await prisma.driver.create({
    data: {
      name: 'Driver One',
      email: 'driver1@example.com',
      password: 'hashedpassword',
      status: DriverStatus.ASSIGNED,
      role: DriverRole.DELIVERY,
      lat: 28.6139,
      lng: 77.209,
    },
  });

  // ================= ORDER =================
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      status: OrderStatus.OUT_FOR_DELIVERY,
      paymentStatus: PaymentStatus.PAID,
      pickupLat: 28.61,
      pickupLng: 77.2,
      deliveryLat: 28.63,
      deliveryLng: 77.22,
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
  const baseLat = 28.61;
  const baseLng = 77.2;

  const trackingData: {
    orderId: string;
    driverId: string;
    lat: number;
    lng: number;
  }[] = [];

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

  console.log('✅ Seeding completed');
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
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
