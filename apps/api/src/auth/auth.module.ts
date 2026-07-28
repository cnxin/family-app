import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { verifyPin } from '../common/pin';
import { DEFAULT_HOUSEHOLD_ID } from '../database/database.constants';
import { Member } from '../entities';
import { CapabilitiesGuard } from './capabilities';
import { JwtAuthGuard, Public } from './jwt.guard';

class LoginDto {
  @IsUUID()
  memberId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pin?: string;
}

function jwtSecret() {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 JWT_SECRET');
  }
  return 'family-app-dev-secret';
}

@Controller()
export class AuthController {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Get('members')
  async list() {
    const list = await this.members.find({
      where: { householdId: DEFAULT_HOUSEHOLD_ID },
      order: { createdAt: 'ASC' },
    });
    return list.map(({ pinHash, ...m }) => ({ ...m, hasPin: !!pinHash }));
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/login')
  async login(@Body() dto: LoginDto) {
    const member = await this.members.findOneBy({
      id: dto.memberId,
      householdId: DEFAULT_HOUSEHOLD_ID,
    });
    if (!member) throw new NotFoundException('成员不存在');
    if (member.pinHash && !(await verifyPin(dto.pin ?? '', member.pinHash))) {
      throw new UnauthorizedException('PIN 不正确');
    }
    const token = await this.jwt.signAsync({
      sub: member.id,
      memberId: member.id,
      householdId: member.householdId,
      name: member.name,
      role: member.role,
    });
    const { pinHash, ...profile } = member;
    return { token, member: profile };
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Member]),
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
        expiresIn: Number(process.env.JWT_EXPIRES_SECONDS || 43_200),
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CapabilitiesGuard },
  ],
})
export class AuthModule {}
