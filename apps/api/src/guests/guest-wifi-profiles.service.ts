import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { encryptIntegrationCredential } from '../common/integration-credentials';
import { GuestWifiProfile } from '../entities';
import { CreateGuestWifiProfileDto, UpdateGuestWifiProfileDto } from './guests.dto';
import { profileGuestWifi, validateWifiPassword } from './guests.helpers';

/** 访客 Wi-Fi 配置：列表、新增、修改，密码加密存（J7.2 从 GuestsService 拆出）。 */
@Injectable()
export class GuestWifiProfilesService {
  constructor(
    @InjectRepository(GuestWifiProfile)
    private readonly guestWifiProfiles: Repository<GuestWifiProfile>,
    private readonly dataSource: DataSource,
  ) {}

  async listGuestWifiProfiles(user: JwtUser) {
    const profiles = await this.guestWifiProfiles.find({
      where: { householdId: user.householdId },
      order: { isActive: 'DESC', updatedAt: 'DESC' },
    });
    return profiles.map(profileGuestWifi);
  }

  async createGuestWifiProfile(dto: CreateGuestWifiProfileDto, user: JwtUser) {
    const name = dto.name.trim();
    const ssid = dto.ssid.trim();
    if (!name) throw new BadRequestException('配置名称不能为空');
    if (!ssid) throw new BadRequestException('Wi-Fi 名称不能为空');
    const password = validateWifiPassword(dto.security, dto.password);
    const profile = await this.guestWifiProfiles.save(
      this.guestWifiProfiles.create({
        householdId: user.householdId,
        name,
        ssid,
        security: dto.security,
        passwordEncrypted: password
          ? encryptIntegrationCredential(password, user.householdId, 'guest-wifi')
          : null,
        isActive: true,
      }),
    );
    await this.dataSource.transaction((manager) =>
      recordActivity(manager, user, {
        module: 'guest',
        action: 'guest_wifi_profile_created',
        summary: `${user.name} 新增了访客 Wi-Fi 配置`,
        targetPath: '/guests',
        metadata: { guestWifiProfileId: profile.id },
      }),
    );
    return profileGuestWifi(profile);
  }

  async updateGuestWifiProfile(id: string, dto: UpdateGuestWifiProfileDto, user: JwtUser) {
    if (!Object.keys(dto).length) throw new BadRequestException('至少需要修改一个字段');
    const profile = await this.guestWifiProfiles
      .createQueryBuilder('guestWifiProfile')
      .addSelect('guestWifiProfile.passwordEncrypted')
      .where('guestWifiProfile.id = :id', { id })
      .andWhere('guestWifiProfile.householdId = :householdId', { householdId: user.householdId })
      .getOne();
    if (!profile) throw new NotFoundException('访客 Wi-Fi 配置不存在');
    const security = dto.security ?? profile.security;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('配置名称不能为空');
      profile.name = name;
    }
    if (dto.ssid !== undefined) {
      const ssid = dto.ssid.trim();
      if (!ssid) throw new BadRequestException('Wi-Fi 名称不能为空');
      profile.ssid = ssid;
    }
    profile.security = security;
    if (security === 'nopass') {
      if (dto.password && dto.password.trim()) throw new BadRequestException('开放网络不能设置密码');
      profile.passwordEncrypted = null;
    } else if (dto.password !== undefined) {
      const password = validateWifiPassword(security, dto.password);
      profile.passwordEncrypted = encryptIntegrationCredential(password!, user.householdId, 'guest-wifi');
    } else if (!profile.passwordEncrypted) {
      throw new BadRequestException('WPA 网络必须设置 8 到 63 位密码');
    }
    if (dto.isActive !== undefined) profile.isActive = dto.isActive;
    const saved = await this.guestWifiProfiles.save(profile);
    await this.dataSource.transaction((manager) =>
      recordActivity(manager, user, {
        module: 'guest',
        action: saved.isActive ? 'guest_wifi_profile_updated' : 'guest_wifi_profile_disabled',
        summary: `${user.name} 更新了访客 Wi-Fi 配置`,
        targetPath: '/guests',
        metadata: { guestWifiProfileId: saved.id },
      }),
    );
    return profileGuestWifi(saved);
  }
}
