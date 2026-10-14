import type { Timestamp } from 'firebase/firestore';

export type MembershipStatus = 'pending' | 'active' | 'suspended';

export interface UserProfile {
  displayName: string;
  email: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Entitlement {
  status: MembershipStatus;
  plan: 'xauusd-lifetime';
  priceMad: 2000;
  updatedAt: Timestamp;
  updatedBy: string;
  lastAuditId: string;
}

export interface MemberRecord {
  uid: string;
  profile: UserProfile;
  entitlement: Entitlement | null;
}

export interface AuditEntry {
  id: string;
  memberUid: string;
  actorUid: string;
  status: MembershipStatus;
  previousStatus: MembershipStatus | null;
  createdAt: Timestamp;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: Timestamp;
  createdBy: string;
}

export interface ApplicationSettings {
  title: string;
  description: string;
  downloadUrl: string;
  brokerUrl: string;
  videos: ApplicationVideo[];
  updatedAt: Timestamp;
  updatedBy: string;
}

export type SignalStatus = 'open' | 'closed' | 'tp_hit' | 'sl_hit';
export interface XauSignal {
  id: string;
  symbol: 'XAUUSD';
  side: 'buy' | 'sell';
  entry: string;
  tp: string;
  sl: string;
  message: string;
  status: SignalStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
  closedAt: Timestamp | null;
  closeNote: string;
  lastEventId: string;
}

export interface ApplicationVideo {
  id: string;
  title: string;
  url: string;
}
