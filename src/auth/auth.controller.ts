import { Body, Post, Controller } from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(
    @Body()
    dto: {
      name: string;
      email: string;
      password: string;
      address: string;
      phone: string;
      lat: number;
      lng: number;
    },
  ) {
    return this.authService.signup(dto);
  }

  @Post('login')
  login(
    @Body()
    dto: {
      email: string;
      password: string;
    },
  ) {
    return this.authService.login(dto);
  }
}
