import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  createFinanceRecurringBody,
  deleteFinanceRecurringQuery,
  payFinanceRecurringBody,
  updateFinanceRecurringBody,
  uuid,
  type CreateFinanceRecurringBody,
  type PayFinanceRecurringBody,
  type UpdateFinanceRecurringBody,
} from '@family/contracts';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod';
import { FinanceRecurringService } from './finance-recurring.service';

// 周期账单接口（K3；K 收尾从 finance-recurring.service.ts 搬出来，加「重试」）。
@Controller('finance/recurring')
@RequireCapabilities('view_finance')
export class FinanceRecurringController {
  constructor(private readonly service: FinanceRecurringService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.service.list(user);
  }

  @Post()
  @RequireCapabilities('manage_finance')
  create(@ZodBody(createFinanceRecurringBody) body: CreateFinanceRecurringBody, @CurrentUser() user: JwtUser) {
    return this.service.create(body, user);
  }

  @Patch(':id')
  @RequireCapabilities('manage_finance')
  update(
    @ZodParam('id', uuid) id: string,
    @ZodBody(updateFinanceRecurringBody) body: UpdateFinanceRecurringBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, body, user);
  }

  @Delete(':id')
  @RequireCapabilities('manage_finance')
  remove(
    @ZodParam('id', uuid) id: string,
    @ZodQuery(deleteFinanceRecurringQuery) query: { expectedVersion: number },
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.remove(id, query.expectedVersion, user);
  }

  @Post(':id/pay')
  @RequireCapabilities('record_finance')
  pay(
    @ZodParam('id', uuid) id: string,
    @ZodBody(payFinanceRecurringBody) body: PayFinanceRecurringBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.pay(id, body, user);
  }

  @Post(':id/retry')
  @RequireCapabilities('manage_finance')
  retry(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.service.retry(id, user);
  }
}
