import { EventBus } from '../events/event-bus';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Member } from '../entities';
import { RequireCapabilities } from './capabilities';
import { AllowWithoutPassword, CurrentUser, JwtUser, Public } from './jwt.guard';
import {
  LoginDto,
  RefreshDto,
  BootstrapDto,
  UpdatePreferencesDto,
  UpdateManagedMemberDto,
  UpdateManagedMemberStatusDto,
  UpdatePasswordDto,
  CreateInvitationDto,
  InvitationTokenDto,
  RedeemInvitationDto,
} from './auth.dto';
import { AUTH_MEMBER_SELECT, AuthService } from './auth.service';
import { InvitationService } from './invitation.service';
import { MemberManagementService } from './member-management.service';
import { memberProfile } from './auth.shared';

@Controller()
export class AuthController {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly auth: AuthService,
    private readonly invitations: InvitationService,
    private readonly memberManagement: MemberManagementService,
    private readonly events: EventBus,
  ) {}

  @Public()
  @Header('Cache-Control', 'no-store')
  @Get('auth/setup/status')
  setupStatus() {
    return this.auth.setupStatus();
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Header('Cache-Control', 'no-store')
  @Post('auth/setup/bootstrap')
  bootstrap(@Body() dto: BootstrapDto) {
    return this.auth.bootstrap(dto);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Header('Cache-Control', 'no-store')
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Post('auth/refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Post('auth/invitations/preview')
  previewInvitation(@Body() dto: InvitationTokenDto) {
    return this.invitations.preview(dto);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Header('Cache-Control', 'no-store')
  @Post('auth/invitations/redeem')
  async redeemInvitation(@Body() dto: RedeemInvitationDto) {
    const session = await this.invitations.redeem(dto);
    // 公开端点，拦截器不知道是哪家：新成员进家后让在线的家里人刷新成员列表
    this.events.publish({
      householdId: session.member.householdId,
      domains: ['members'],
      actor: session.member.id,
    });
    return session;
  }

  @HttpCode(200)
  @AllowWithoutPassword()
  @Post('auth/logout')
  logout(@CurrentUser() user: JwtUser) {
    return this.auth.logout(user);
  }

  @Get('members')
  async list(@CurrentUser() user: JwtUser) {
    const list = await this.members.find({
      where: { householdId: user.householdId, disabledAt: IsNull() },
      order: { createdAt: 'ASC' },
      select: AUTH_MEMBER_SELECT,
    });
    return list.map(memberProfile);
  }

  @RequireCapabilities('manage_members')
  @Get('household/members')
  managedMembers(@CurrentUser() user: JwtUser) {
    return this.memberManagement.list(user);
  }

  @RequireCapabilities('manage_members')
  @Patch('household/members/:id')
  updateManagedMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagedMemberDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.memberManagement.update(id, dto, user);
  }

  @RequireCapabilities('manage_members')
  @Patch('household/members/:id/status')
  updateManagedMemberStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagedMemberStatusDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.memberManagement.setStatus(id, dto, user);
  }

  @Patch('members/me/preferences')
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() user: JwtUser,
  ) {
    const member = await this.members.findOneBy({
      id: user.memberId,
      accountId: user.accountId,
      householdId: user.householdId,
    });
    if (!member) throw new NotFoundException('成员不存在');
    member.prefersCooking = dto.prefersCooking;
    return memberProfile(await this.members.save(member));
  }

  @HttpCode(200)
  @AllowWithoutPassword()
  @Patch('accounts/me/password')
  updatePassword(
    @Body() dto: UpdatePasswordDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.auth.updatePassword(user, dto);
  }

  @RequireCapabilities('manage_members')
  @Get('household/invitations')
  listInvitations(@CurrentUser() user: JwtUser) {
    return this.invitations.list(user);
  }

  @RequireCapabilities('manage_members')
  @Post('household/invitations')
  createInvitation(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.invitations.create(user, dto);
  }

  @RequireCapabilities('manage_members')
  @Delete('household/invitations/:id')
  revokeInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.invitations.revoke(user, id);
  }
}
