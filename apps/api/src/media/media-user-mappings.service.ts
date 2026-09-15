import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  MediaLibraryProviderKind,
  MediaUserMapping,
  Member,
} from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import { isUniqueViolation } from '@family/shared';

function publicMember(member: Member) {
  return {
    id: member.id,
    name: member.name,
    avatarEmoji: member.avatarEmoji,
    disabledAt: member.disabledAt,
  };
}

@Injectable()
export class MediaUserMappingsService {
  constructor(
    @InjectRepository(MediaUserMapping)
    private readonly mappings: Repository<MediaUserMapping>,
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
  ) {}

  async list(user: JwtUser) {
    const [directories, mappings] = await Promise.all([
      this.connectors.playbackUsers(user.householdId),
      this.mappings.find({
        where: { householdId: user.householdId },
        relations: { member: true },
        order: { externalUserName: 'ASC' },
      }),
    ]);

    return directories.map((directory) => {
      const connectorMappings = mappings.filter(
        (mapping) => mapping.connectorKey === directory.connectorKey,
      );
      const seenMappingIds = new Set<string>();
      const liveUsers = directory.users.map((externalUser) => {
        const mapping = connectorMappings.find(
          (candidate) =>
            candidate.serverId === directory.serverId &&
            candidate.externalUserId === externalUser.externalUserId,
        );
        if (mapping) seenMappingIds.add(mapping.id);
        return {
          serverId: directory.serverId,
          externalUserId: externalUser.externalUserId,
          name: externalUser.name,
          isDisabled: externalUser.isDisabled,
          isStale: false,
          mapping: mapping
            ? { id: mapping.id, member: publicMember(mapping.member) }
            : null,
        };
      });
      const staleUsers = connectorMappings
        .filter((mapping) => !seenMappingIds.has(mapping.id))
        .map((mapping) => ({
          serverId: mapping.serverId,
          externalUserId: mapping.externalUserId,
          name: mapping.externalUserName,
          isDisabled: false,
          isStale: directory.state === 'online',
          mapping: { id: mapping.id, member: publicMember(mapping.member) },
        }));
      return {
        ...directory,
        users: [...liveUsers, ...staleUsers],
      };
    });
  }

  async map(
    provider: MediaLibraryProviderKind,
    externalUserIdValue: string,
    memberId: string,
    user: JwtUser,
  ) {
    const externalUserId = externalUserIdValue.trim();
    if (!externalUserId || externalUserId.length > 180) {
      throw new BadRequestException('外部用户 ID 无效');
    }
    const [directory] = await this.connectors.playbackUsers(
      user.householdId,
      provider,
    );
    if (!directory || directory.state !== 'online' || !directory.serverId) {
      throw new BadGatewayException(directory?.message ?? '媒体服务不可用');
    }
    const serverId = directory.serverId;
    const externalUser = directory.users.find(
      (candidate) => candidate.externalUserId === externalUserId,
    );
    if (!externalUser) throw new NotFoundException('媒体服务中没有该用户');
    if (externalUser.isDisabled) {
      throw new BadRequestException('已停用的外部用户不能建立映射');
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const member = await manager
          .getRepository(Member)
          .createQueryBuilder('member')
          .where('member.id = :memberId', { memberId })
          .andWhere('member.householdId = :householdId', {
            householdId: user.householdId,
          })
          .andWhere('member.disabledAt IS NULL')
          .setLock('pessimistic_write')
          .getOne();
        if (!member) throw new NotFoundException('家庭成员不存在或已停用');

        const repository = manager.getRepository(MediaUserMapping);
        const existing = await repository
          .createQueryBuilder('mapping')
          .where('mapping.householdId = :householdId', {
            householdId: user.householdId,
          })
          .andWhere('mapping.connectorKey = :connectorKey', {
            connectorKey: directory.connectorKey,
          })
          .andWhere('mapping.serverId = :serverId', {
            serverId,
          })
          .andWhere('mapping.externalUserId = :externalUserId', {
            externalUserId,
          })
          .setLock('pessimistic_write')
          .getOne();
        const memberMapping = await repository.findOneBy({
          householdId: user.householdId,
          connectorKey: directory.connectorKey,
          serverId,
          memberId,
        });
        if (memberMapping && memberMapping.id !== existing?.id) {
          throw new ConflictException('该家庭成员已关联此媒体服务的其他用户');
        }

        const changed = existing?.memberId !== memberId;
        const mapping =
          existing ??
          repository.create({
            householdId: user.householdId,
            provider,
            connectorKey: directory.connectorKey,
            serverId,
            externalUserId,
          });
        mapping.externalUserName = externalUser.name;
        mapping.memberId = memberId;
        mapping.lastSeenAt = new Date();
        const saved = await repository.save(mapping);

        if (changed) {
          await recordActivity(manager, user, {
            module: 'media',
            action: 'media_user_mapping_updated',
            summary: `将 ${directory.name} 用户「${externalUser.name}」关联到 ${member.name}`,
            subjectMemberId: member.id,
            targetPath: '/media/settings?section=users',
            metadata: {
              provider,
              connectorKey: directory.connectorKey,
              serverId,
              externalUserId,
            },
          });
        }
        return {
          id: saved.id,
          member: publicMember(member),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('该外部用户或家庭成员已有其他映射');
      }
      throw error;
    }
  }

  async unmap(mappingId: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const mapping = await manager
        .getRepository(MediaUserMapping)
        .createQueryBuilder('mapping')
        .leftJoinAndSelect('mapping.member', 'member')
        .where('mapping.id = :mappingId', { mappingId })
        .andWhere('mapping.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write', undefined, ['mapping'])
        .getOne();
      if (!mapping) throw new NotFoundException('用户映射不存在');
      await manager.getRepository(MediaUserMapping).delete(mapping.id);
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_user_mapping_deleted',
        summary: `取消了 ${mapping.provider === 'plex' ? 'Plex' : 'Emby'} 用户「${mapping.externalUserName}」与 ${mapping.member.name} 的关联`,
        subjectMemberId: mapping.memberId,
        targetPath: '/media/settings?section=users',
        metadata: {
          provider: mapping.provider,
          connectorKey: mapping.connectorKey,
          serverId: mapping.serverId,
          externalUserId: mapping.externalUserId,
        },
      });
      return { deleted: true };
    });
  }
}
