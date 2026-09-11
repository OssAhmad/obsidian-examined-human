export interface EngagementDashboardSummaryRecord {
  id: number;
  name: string;
  aliases: string[];
  type: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  completionDate: string | null;
  notes: string | null;
  sessionCount: number;
  totalMinutes: number;
  firstSessionDate: string | null;
  lastSessionDate: string | null;
  milestoneCount: number;
}

export interface EngagementActivityRecord {
  date: string;
  sessionCount: number;
  totalMinutes: number;
}

export interface EngagementSessionTypeRecord {
  sessionType: string;
  sessionCount: number;
  totalMinutes: number;
}

export interface EngagementMilestoneMeasurementRecord {
  id: number;
  metricName: string;
  metricValue: string;
  measurementDate: string | null;
  notes: string | null;
}

export interface EngagementMilestoneRecord {
  id: number;
  name: string;
  date: string | null;
  notes: string | null;
  ownerSessionId: number | null;
  ownerSessionDate: string | null;
  ownerStartTime: string | null;
  ownerEndTime: string | null;
  measurements: EngagementMilestoneMeasurementRecord[];
}

export interface EngagementTransactionTotalRecord {
  currency: string;
  transactionCount: number;
  inflow: number;
  outflow: number;
  net: number;
}

export interface EngagementRecentSessionRecord {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  sessionType: string;
  notes: string | null;
}

export interface EngagementTransactionRecord {
  id: number;
  date: string;
  amount: number;
  currency: string;
  accountName: string;
  description: string | null;
}

export interface EngagementDashboardQueryResult {
  startDate: string | null;
  endDate: string;
  engagements: EngagementDashboardSummaryRecord[];
  selectedEngagement: EngagementDashboardSummaryRecord | null;
  dailyActivity: EngagementActivityRecord[];
  sessionTypes: EngagementSessionTypeRecord[];
  milestones: EngagementMilestoneRecord[];
  transactionTotals: EngagementTransactionTotalRecord[];
  transactions: EngagementTransactionRecord[];
  recentSessions: EngagementRecentSessionRecord[];
  unassignedTransactionCount: number;
}

export { queryEngagementDashboard } from '../examined-human-query.ts';
