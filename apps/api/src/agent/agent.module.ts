import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgentConversation,
  AgentActionProposal,
  AgentChannelPairing,
  AgentMemberChannel,
  AgentMemberProfile,
  AgentMemoryEvent,
  AgentMemoryItem,
  AgentMessage,
  AgentProposalGroup,
  AgentProposalGroupEvent,
  AgentRun,
  AgentRoutine,
  AgentRoutineItem,
  AgentSetting,
  AgentToolEvent,
  Member,
} from '../entities';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { AgentController } from './agent.controller';
import { AgentChannelInternalController } from './agent-channel-internal.controller';
import { AgentMcpController } from './agent-mcp.controller';
import { FakeAgentRuntime, HermesAgentRuntime } from './agent-runtimes';
import { NativeAgentRuntime } from './native/native-runtime';
import { AgentService } from './agent.service';
import { AgentVisionService } from './agent-vision.service';
import { AgentToolsService } from './agent-tools.service';
import { AgentProposalsService } from './agent-proposals.service';
import { AgentChannelsService } from './agent-channels.service';
import { AgentRetentionService } from './agent-retention.service';
import { AgentMemoryService } from './agent-memory.service';
import {
  AgentRoutineService,
  ROUTINE_CALENDAR,
  ROUTINE_INVENTORY,
  ROUTINE_SHOPPING,
  type RoutineCalendarReader,
  type RoutineInventoryReader,
  type RoutineShoppingReader,
} from './agent-routine.service';
import { AgentProposalGroupsService } from './agent-proposal-groups.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentSetting,
      AgentActionProposal,
      AgentChannelPairing,
      AgentMemberChannel,
      AgentMemberProfile,
      AgentMemoryItem,
      AgentMemoryEvent,
      AgentProposalGroup,
      AgentProposalGroupEvent,
      AgentRoutine,
      AgentRoutineItem,
      AgentConversation,
      AgentMessage,
      AgentRun,
      AgentToolEvent,
      Member,
    ]),
  ],
  controllers: [
    AgentController,
    AgentMcpController,
    AgentChannelInternalController,
  ],
  providers: [
    AgentService,
    AgentVisionService,
    AgentToolsService,
    FakeAgentRuntime,
    HermesAgentRuntime,
    NativeAgentRuntime,
    AgentProposalsService,
    AgentChannelsService,
    AgentRetentionService,
    AgentMemoryService,
    AgentRoutineService,
    AgentProposalGroupsService,
    // 例行任务的每晚汇总 / 每周回顾经门面读日历、购物、库存（J4.1：agent 目录不 import 插件目录）；
    // 门面在插件 onModuleInit 时才注册，所以用到时再 get
    {
      provide: ROUTINE_CALENDAR,
      inject: [PluginFacadeRegistry],
      useFactory: (facades: PluginFacadeRegistry): RoutineCalendarReader => ({
        list: (start, end, user) => facades.get('calendar').listEntries(start, end, user),
      }),
    },
    {
      provide: ROUTINE_SHOPPING,
      inject: [PluginFacadeRegistry],
      useFactory: (facades: PluginFacadeRegistry): RoutineShoppingReader => ({
        list: (householdId, date) => facades.get('shopping').listItems(householdId, date),
      }),
    },
    {
      provide: ROUTINE_INVENTORY,
      inject: [PluginFacadeRegistry],
      useFactory: (facades: PluginFacadeRegistry): RoutineInventoryReader => ({
        list: (householdId) => facades.get('inventory').listStockStatus(householdId),
      }),
    },
  ],
  // 截图记账（财务插件）用内核的云端看图（J4 第四批）
  exports: [AgentVisionService],
})
export class AgentModule {}
