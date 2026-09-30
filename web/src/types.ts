export type Role = "official" | "verifier";

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  title: string;
  organization: string;
  badgeNo?: string;
}

export interface Profile extends User {
  isSuper: boolean;
}

export interface Scope {
  code: string;
  label: string;
  description: string;
}

export interface Tx {
  id: string;
  type: "GRANT" | "REVOKE" | "VERIFY";
  actor: string;
  subject: string;
  scope: string;
  ref?: string;
  expiresAt?: number;
  note?: string;
  timestamp: number;
}

export interface Block {
  index: number;
  timestamp: number;
  transactions: Tx[];
  prevHash: string;
  nonce: number;
  miner: string;
  hash: string;
}

export interface Grant {
  txId: string;
  grantor: string;
  grantee: string;
  scope: string;
  note?: string;
  expiresAt?: number;
  grantedAt: number;
  block: number;
  revoked: boolean;
  revokedBy?: string;
  revokedAt?: number;
  status: "active" | "revoked" | "expired";
}

export type VerificationStatus = "pending" | "approved" | "declined" | "unauthorized" | "expired";

export interface Proof {
  authorized: boolean;
  checkedAt: string;
  txId?: string;
  blockIndex?: number;
  blockHash?: string;
  minedBy?: string;
  grant?: Grant;
  provenance?: Grant[];
}

export interface Verification {
  id: string;
  verifierId: string;
  scope: string;
  purpose: string;
  status: VerificationStatus;
  officialId?: string;
  proof?: Proof;
  createdAt: string;
  decidedAt?: string;
}

export interface VerificationDetail {
  request: Verification;
  expiresAt: string;
  verifier?: User;
  official?: User;
}

export interface NodeStatus {
  name: string;
  online: boolean;
  height?: number;
  length?: number;
  tipHash?: string;
  genesisHash?: string;
  difficulty?: number;
}
