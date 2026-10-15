import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  adjustmentBody,
  createRewardBody,
  decideRedemptionBody,
  ledgerOperationBody,
  ledgerQuery,
  redemptionQuery,
  rewardsQuery,
  updateRewardBody,
  type AdjustmentBody,
  type CreateRewardBody,
  type DecideRedemptionBody,
  type LedgerOperationBody,
  type LedgerQuery,
  type RedemptionQuery,
  type RewardsQuery,
  type UpdateRewardBody,
} from '@family/contracts';
import { ZodBody, ZodQuery } from '../common/zod';
import { PointsService } from './points.service';
import { PointsRewardsService } from './points-rewards.service';
import { PointsRedemptionsService } from './points-redemptions.service';

@Controller()
export class PointsController {
  constructor(
    private readonly service: PointsService,
    private readonly rewardsService: PointsRewardsService,
    private readonly redemptionsService: PointsRedemptionsService,
  ) {}

  @Get('points/accounts')
  accounts(@CurrentUser() user: JwtUser) {
    return this.service.listAccounts(user);
  }

  @Get('points/ledger')
  ledger(@ZodQuery(ledgerQuery) query: LedgerQuery, @CurrentUser() user: JwtUser) {
    return this.service.listLedger(query, user);
  }

  @Post('points/adjustments')
  @RequireCapabilities('manage_points')
  adjust(@ZodBody(adjustmentBody) dto: AdjustmentBody, @CurrentUser() user: JwtUser) {
    return this.service.adjust(dto, user);
  }

  @Post('points/ledger/:id/reverse')
  @RequireCapabilities('manage_points')
  reverseLedger(
    @Param('id') id: string,
    @ZodBody(ledgerOperationBody) dto: LedgerOperationBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.reverseLedger(id, dto, user);
  }

  @Get('rewards')
  rewards(
    @ZodQuery(rewardsQuery) query: RewardsQuery,
    @CurrentUser() user: JwtUser,
  ) {
    return this.rewardsService.listRewards(query.includeInactive === 'true', user);
  }

  @Post('rewards')
  @RequireCapabilities('manage_points')
  createReward(@ZodBody(createRewardBody) dto: CreateRewardBody, @CurrentUser() user: JwtUser) {
    return this.rewardsService.createReward(dto, user);
  }

  @Patch('rewards/:id')
  @RequireCapabilities('manage_points')
  updateReward(
    @Param('id') id: string,
    @ZodBody(updateRewardBody) dto: UpdateRewardBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.rewardsService.updateReward(id, dto, user);
  }

  @Post('rewards/:id/redemptions')
  redeem(
    @Param('id') id: string,
    @ZodBody(ledgerOperationBody) dto: LedgerOperationBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.redemptionsService.redeem(id, dto, user);
  }

  @Get('reward-redemptions')
  redemptions(
    @ZodQuery(redemptionQuery) query: RedemptionQuery,
    @CurrentUser() user: JwtUser,
  ) {
    return this.redemptionsService.listRedemptions(query, user);
  }

  @Post('reward-redemptions/:id/decision')
  @RequireCapabilities('manage_points')
  decide(
    @Param('id') id: string,
    @ZodBody(decideRedemptionBody) dto: DecideRedemptionBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.redemptionsService.decide(id, dto, user);
  }

  @Post('reward-redemptions/:id/cancel')
  cancel(
    @Param('id') id: string,
    @ZodBody(ledgerOperationBody) dto: LedgerOperationBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.redemptionsService.cancel(id, dto, user);
  }

  @Post('reward-redemptions/:id/reverse')
  @RequireCapabilities('manage_points')
  reverseRedemption(
    @Param('id') id: string,
    @ZodBody(ledgerOperationBody) dto: LedgerOperationBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.redemptionsService.reverseRedemption(id, dto, user);
  }
}
