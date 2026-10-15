import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import { RequireCapabilities } from '../auth/capabilities';
import { VisitStatus } from '../entities';
import {
  CreateGuestDto,
  UpdateGuestDto,
  CreateVisitDto,
  UpdateVisitDto,
  CreateGuestInvitationDto,
  GuestResponseDto,
  GuestPollVoteDto,
  GuestMealRequestDto,
  ReviewGuestMealRequestDto,
  CreateGuestWifiProfileDto,
  UpdateGuestWifiProfileDto,
} from './guests.dto';
import { GuestsService } from './guests.service';
import { GuestPortalService } from './guest-portal.service';
import { GuestWifiProfilesService } from './guest-wifi-profiles.service';
import { GuestInvitationsService } from './guest-invitations.service';

@Controller()
export class GuestsController {
  constructor(
    private readonly service: GuestsService,
    private readonly portal: GuestPortalService,
    private readonly wifiProfiles: GuestWifiProfilesService,
    private readonly invitations: GuestInvitationsService,
  ) {}

  @Get('guests')
  @RequireCapabilities('manage_guests')
  listGuests(@CurrentUser() user: JwtUser) {
    return this.service.listGuests(user);
  }

  @Post('guests')
  @RequireCapabilities('manage_guests')
  createGuest(@Body() dto: CreateGuestDto, @CurrentUser() user: JwtUser) {
    return this.service.createGuest(dto, user);
  }

  @Patch('guests/:id')
  @RequireCapabilities('manage_guests')
  updateGuest(@Param('id') id: string, @Body() dto: UpdateGuestDto, @CurrentUser() user: JwtUser) {
    return this.service.updateGuest(id, dto, user);
  }

  @Post('guests/:id/anonymize')
  @RequireCapabilities('manage_guests')
  anonymizeGuest(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.anonymizeGuest(id, user);
  }

  @Get('guest-wifi-profiles')
  @RequireCapabilities('manage_guests')
  listGuestWifiProfiles(@CurrentUser() user: JwtUser) {
    return this.wifiProfiles.listGuestWifiProfiles(user);
  }

  @Post('guest-wifi-profiles')
  @RequireCapabilities('manage_guests')
  createGuestWifiProfile(@Body() dto: CreateGuestWifiProfileDto, @CurrentUser() user: JwtUser) {
    return this.wifiProfiles.createGuestWifiProfile(dto, user);
  }

  @Patch('guest-wifi-profiles/:id')
  @RequireCapabilities('manage_guests')
  updateGuestWifiProfile(@Param('id') id: string, @Body() dto: UpdateGuestWifiProfileDto, @CurrentUser() user: JwtUser) {
    return this.wifiProfiles.updateGuestWifiProfile(id, dto, user);
  }

  @Get('visits')
  @RequireCapabilities('manage_guests')
  listVisits(@CurrentUser() user: JwtUser, @Query('status') status?: VisitStatus) {
    if (status && !['scheduled', 'cancelled', 'completed'].includes(status)) {
      throw new BadRequestException('来访状态无效');
    }
    return this.service.listVisits(user, status);
  }

  @Post('visits')
  @RequireCapabilities('manage_guests')
  createVisit(@Body() dto: CreateVisitDto, @CurrentUser() user: JwtUser) {
    return this.service.createVisit(dto, user);
  }

  @Patch('visits/:id')
  @RequireCapabilities('manage_guests')
  updateVisit(@Param('id') id: string, @Body() dto: UpdateVisitDto, @CurrentUser() user: JwtUser) {
    return this.service.updateVisit(id, dto, user);
  }

  @Post('visits/:id/invitations')
  @RequireCapabilities('manage_guests')
  createInvitation(@Param('id') id: string, @Body() dto: CreateGuestInvitationDto, @CurrentUser() user: JwtUser) {
    return this.invitations.createInvitation(id, dto, user);
  }

  @Delete('guest-invitations/:id')
  @RequireCapabilities('manage_guests')
  revokeInvitation(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.invitations.revokeInvitation(id, user);
  }

  @Public()
  @Get('guest-invitations/:token')
  publicInvitation(@Param('token') token: string) {
    return this.portal.publicInvitation(token);
  }

  @Public()
  @Post('guest-invitations/:token/response')
  respond(@Param('token') token: string, @Body() dto: GuestResponseDto) {
    return this.portal.respond(token, dto);
  }

  @Public()
  @Get('guest-invitations/:token/movie-polls')
  publicMoviePolls(@Param('token') token: string) {
    return this.portal.publicMoviePolls(token);
  }

  @Public()
  @Post('guest-invitations/:token/movie-polls/:pollId/votes')
  voteMoviePoll(
    @Param('token') token: string,
    @Param('pollId') pollId: string,
    @Body() dto: GuestPollVoteDto,
  ) {
    return this.portal.voteMoviePoll(token, pollId, dto);
  }

  @Public()
  @Get('guest-invitations/:token/meal-requests')
  publicMealRequests(@Param('token') token: string) {
    return this.portal.publicMealRequests(token);
  }

  @Public()
  @Get('guest-invitations/:token/meal-options')
  publicMealOptions(@Param('token') token: string) {
    return this.portal.publicMealOptions(token);
  }

  @Public()
  @Post('guest-invitations/:token/meal-options/:menuItemId/request')
  claimMealOption(@Param('token') token: string, @Param('menuItemId') menuItemId: string) {
    return this.portal.claimMealOption(token, menuItemId);
  }

  @Public()
  @Post('guest-invitations/:token/meal-requests')
  submitMealRequest(@Param('token') token: string, @Body() dto: GuestMealRequestDto) {
    return this.portal.submitMealRequest(token, dto);
  }

  @Patch('guest-meal-requests/:id')
  @RequireCapabilities('manage_guests')
  reviewMealRequest(
    @Param('id') id: string,
    @Body() dto: ReviewGuestMealRequestDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.reviewMealRequest(id, dto, user);
  }
}
