import type {
  SmartHomeDevice as SmartHomeDeviceView,
  SmartHomeDomain,
  SmartHomeEntityState,
  SmartHomeIcon,
} from '@family/contracts';
import type { SmartHomeDevice } from '../entities';

/** HA 上已经没有这个实体（被删了、改了 ID）时的状态。 */
export const UNAVAILABLE_STATE: SmartHomeEntityState = {
  state: 'unavailable',
  unit: null,
  deviceClass: null,
  position: null,
  battery: null,
  lastChanged: null,
  lastUpdated: null,
  targetTemperature: null,
  currentTemperature: null,
  hvacModes: null,
  minTemperature: null,
  maxTemperature: null,
  assumed: false,
  fanSpeed: null,
  fanMode: null,
  swingMode: null,
  humidity: null,
};

export function presentSmartHomeDevice(row: SmartHomeDevice): SmartHomeDeviceView {
  return {
    id: row.id,
    haDeviceId: row.haDeviceId,
    displayName: row.displayName,
    area: row.area,
    sortOrder: row.sortOrder,
    icon: row.icon as SmartHomeIcon,
    primaryEntityId: row.primaryEntityId,
    primaryDomain: row.primaryDomain as SmartHomeDomain,
    featuredEntityIds: row.featuredEntityIds ?? [],
    hiddenEntityIds: row.hiddenEntityIds ?? [],
    controllable: row.controllable,
    minRole: row.minRole,
    pinnedToToday: row.pinnedToToday,
    legacy: row.mergeState === 'legacy',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
