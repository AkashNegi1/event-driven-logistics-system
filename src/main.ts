import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const env = configService.get<string>('NODE_ENV', 'development');
  const rawOrigins = configService.get<string>('CORS_ORIGINS', '');
  let corsOrigins: string[];
  if (rawOrigins && rawOrigins !== '*') {
    corsOrigins = rawOrigins.split(',').map((s) => s.trim());
  } else {
    corsOrigins = env === 'production'
      ? []
      : ['http://localhost:5173', 'http://127.0.0.1:5500'];
  }

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
