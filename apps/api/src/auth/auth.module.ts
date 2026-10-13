import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { jwtSecret } from '../common/config';
import {
  Account,
  AuthSession,
  Household,
  HouseholdActivityLog,
  HouseholdInvitation,
  Member,
} from '../entities';
import { CapabilitiesGuard } from './capabilities';
import { JwtAuthGuard } from './jwt.guard';
import { accessTokenExpiresSeconds } from './session.tokens';
import { AuthService } from './auth.service';
import { InvitationService } from './invitation.service';
import { MemberManagementService } from './member-management.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Household,
      Member,
      AuthSession,
      HouseholdInvitation,
      HouseholdActivityLog,
    ]),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.LOGIN_RATE_WINDOW_MS || 60_000),
        limit: Number(process.env.LOGIN_RATE_LIMIT || 5),
      },
    ]),
    JwtModule.register({
      global: true,
      secret: jwtSecret(),
      signOptions: {
        expiresIn: accessTokenExpiresSeconds(),
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MemberManagementService,
    InvitationService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CapabilitiesGuard },
  ],
})
export class AuthModule {}
