import { InitialSchema1785226400000 } from './1785226400000-initial-schema';
import { AddHouseholdScope1785226500000 } from './1785226500000-add-household-scope';
import { HardenAuthAndOrders1785226600000 } from './1785226600000-harden-auth-and-orders';
import { AddKitchenCollaboration1785226700000 } from './1785226700000-add-kitchen-collaboration';
import { AddRevocableAuthSessions1785226800000 } from './1785226800000-add-revocable-auth-sessions';

export const ALL_MIGRATIONS = [
  InitialSchema1785226400000,
  AddHouseholdScope1785226500000,
  HardenAuthAndOrders1785226600000,
  AddKitchenCollaboration1785226700000,
  AddRevocableAuthSessions1785226800000,
];
