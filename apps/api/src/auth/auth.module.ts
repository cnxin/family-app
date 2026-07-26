import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { Member } from '../entities';
import { JwtAuthGuard, Public } from './jwt.guard';

class LoginDto {
  @IsUUID()
  memberId: string;

  @IsOptional()
  @IsString()
  pin?: string;
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
    const list = await this.members.find({ order: { createdAt: 'ASC' } });
    return list.map(({ pin, ...m }) => ({ ...m, hasPin: !!pin }));
  }

  @Public()
  @Post('auth/login')
  async login(@Body() dto: LoginDto) {
    const member = await this.members.findOneBy({ id: dto.memberId });
    if (!member) throw new NotFoundException('成员不存在');
    if (member.pin && member.pin !== dto.pin) {
      throw new UnauthorizedException('PIN 不正确');
    }
    const token = await this.jwt.signAsync({
      sub: member.id,
      name: member.name,
      role: member.role,
    });
    const { pin, ...profile } = member;
    return { token, member: profile };
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Member]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'family-app-dev-secret',
      signOptions: { expiresIn: '180d' },
    }),
  ],
  controllers: [AuthController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
