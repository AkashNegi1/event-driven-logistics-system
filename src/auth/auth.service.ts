import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private token(userId: string, email: string) {
    return { accessToken: this.jwtService.sign({ sub: userId, email }) };
  }
  async signup(dto: {
    name: string;
    email: string;
    password: string;
    address: string;
    phone: string;
    lat: number;
    lng: number;
  }) {
    const hashedpassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        ...dto,
        password: hashedpassword,
      },
    });
    return this.token(user.id, user.email);
  }

  async login(dto: { email: string; password: string }) {
    const user = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid Credentials');
    }

    return this.token(user.id, user.email);
  }
}
