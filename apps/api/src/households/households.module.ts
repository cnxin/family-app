import { Controller, ForbiddenException, Injectable, Module, Patch } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  updateHouseholdTimezoneBody,
  type UpdateHouseholdTimezoneBody,
} from '@family/contracts';
import { isHouseholdManager } from '@family/shared';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody } from '../common/zod';
import { Household } from '../entities';

@Injectable()
export class HouseholdsService {
  constructor(
    @InjectRepository(Household) private readonly households: Repository<Household>,
  ) {}

  async updateTimezone(user: JwtUser, timezone: string) {
    if (!isHouseholdManager(user)) {
      throw new ForbiddenException('只有家庭管理员可以修改家庭时区');
    }
    const household = await this.households.findOneByOrFail({ id: user.householdId });
    household.timezone = timezone;
    const saved = await this.households.save(household);
    return { id: saved.id, name: saved.name, timezone: saved.timezone };
  }
}

@Controller('households')
export class HouseholdsController {
  constructor(private readonly households: HouseholdsService) {}

  @Patch('me')
  update(
    @CurrentUser() user: JwtUser,
    @ZodBody(updateHouseholdTimezoneBody) body: UpdateHouseholdTimezoneBody,
  ) {
    return this.households.updateTimezone(user, body.timezone);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Household])],
  controllers: [HouseholdsController],
  providers: [HouseholdsService],
})
export class HouseholdsModule {}
