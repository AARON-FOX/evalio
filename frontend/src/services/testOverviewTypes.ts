export interface TestOverview {
  id: string;
  title: string;
  description: string | null;
  kind: "test" | "survey";
  subject: string | null;
  classGroup: string | null;
  versionNumber: number;
  questionCount: number;
  maxPoints: number | null;
  durationMinutes: number | null;
  maxAttempts: number | null;
  usedAttempts: number;
  remainingAttempts: number | null;
  availableUntil: string | null;
  deadlinePassed: boolean;
  canStart: boolean;
  hasActiveAttempt: boolean;
  activeAttemptExpiresAt: string | null;
}
