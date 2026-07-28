export type UserRole =
  | "super_admin"
  | "exam_admin"
  | "proctor"
  | "question_author"
  | "candidate";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  phone?: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserListResponse {
  data: User[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateUserInput {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  phone?: string;
}

export interface UpdateUserInput {
  fullName?: string;
  role?: UserRole;
  phone?: string;
  isActive?: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Subject {
  id: string;
  institutionId: string;
  name: string;
  code: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionBank {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type QuestionType =
  | "mcq_single"
  | "mcq_multiple"
  | "fill_in_blank"
  | "essay"
  | "true_false"
  | "matching"
  | "assertion_reason"
  | "comprehension"
  | "drag_drop"
  | "image_based"
  | "audio_video"
  | "numerical"
  | "matrix_match";

export type CognitiveLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

export interface QuestionOption {
  id?: string;
  questionId?: string;
  optionText: string;
  isCorrect: boolean;
  displayOrder: number;
}

export interface Question {
  id: string;
  subjectId: string;
  type: QuestionType;
  cognitiveLevel?: CognitiveLevel | null;
  contentJson: Record<string, unknown>;
  mediaUrlsJson?: string[] | null;
  solutionJson?: Record<string, unknown> | null;
  version: number;
  createdBy: string;
  usageCount: number;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
  options?: QuestionOption[];
  tags?: string[];
}

export interface CreateQuestionInput {
  subjectId: string;
  type: QuestionType;
  cognitiveLevel?: CognitiveLevel | null;
  content: { text: string; latex?: string | null; passageId?: string | null };
  mediaUrls?: string[];
  options?: { text: string; isCorrect: boolean; displayOrder: number }[];
  solution?: { text?: string; explanation?: string } | null;
  tags?: string[];
}

export interface QuestionVersion {
  id: string;
  questionId: string;
  versionNumber: number;
  contentJson: Record<string, unknown>;
  changedBy: string;
  changeReason?: string | null;
  createdAt: string;
}

export interface Institution {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstitutionInput {
  name: string;
  code: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface UpdateInstitutionInput {
  name?: string;
  code?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface Batch {
  id: string;
  institutionId: string;
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  institutionName?: string;
}

export interface CreateBatchInput {
  institutionId: string;
  name: string;
  code: string;
}

export interface UpdateBatchInput {
  institutionId?: string;
  name?: string;
  code?: string;
}

/* ---------- Exam Types ---------- */

export type SelectionStrategy = "static" | "random" | "hybrid";
export type NavigationMode = "free" | "linear" | "section_free";

export interface ExamSection {
  id: string;
  examId: string;
  name: string;
  sectionOrder: number;
  durationMinutes?: number | null;
  totalMarks: string;
  questionCount: number;
  navigationMode?: NavigationMode | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  instructionsJson?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  questions?: ExamQuestionRef[];
}

export interface ExamQuestionRef {
  id?: string;
  examSectionId: string;
  questionId: string;
  displayOrder: number;
  isOptional: boolean;
  type?: string;
  contentJson?: unknown;
  options?: { optionText: string; isCorrect: boolean; displayOrder: number }[];
}

export interface Exam {
  id: string;
  subjectId?: string | null;
  batchId?: string | null;
  name: string;
  description?: string | null;
  code: string;
  durationMinutes: number;
  totalMarks: string;
  selectionStrategy: SelectionStrategy;
  navigationMode: NavigationMode;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  instructionsJson?: Record<string, unknown> | null;
  resultVisibility: string;
  scheduledStartAt?: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sections?: ExamSection[];
  subjectName?: string | null;
  batchName?: string | null;
  institutionName?: string | null;
  institutionId?: string | null;
}

export interface CreateExamInput {
  subjectId?: string | null;
  batchId?: string | null;
  name: string;
  code: string;
  description?: string;
  durationMinutes: number;
  totalMarks: number;
  selectionStrategy?: SelectionStrategy;
  navigationMode?: NavigationMode;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  instructions?: { title?: string; body?: string; rules?: string[] };
  resultVisibility?: string;
  scheduledStartAt?: string | null;
}

export interface UpdateExamInput extends Partial<CreateExamInput> {}

export interface CreateSectionInput {
  name: string;
  sectionOrder: number;
  durationMinutes?: number;
  totalMarks: number;
  questionCount: number;
  navigationMode?: NavigationMode;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  instructions?: Record<string, unknown>;
}

export interface AddExamQuestionsInput {
  questionIds: string[];
  isOptional?: boolean;
}

/* ---------- Exam Batch Types ---------- */

export type ExamBatchStatus =
  | "draft"
  | "scheduled"
  | "published"
  | "active"
  | "paused"
  | "submission_window"
  | "finished"
  | "results_published"
  | "archived";

export interface ExamBatch {
  id: string;
  examId: string;
  batchId: string | null;
  name: string;
  status: ExamBatchStatus;
  scheduledStartAt: string;
  scheduledEndAt: string;
  actualStartAt: string | null;
  actualEndAt: string | null;
  gracePeriodMinutes: number;
  instructionsJson: Record<string, unknown> | null;
  settingsJson: Record<string, unknown> | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamBatchListItem {
  id: string;
  examId: string;
  batchId: string | null;
  name: string;
  status: ExamBatchStatus;
  scheduledStartAt: string;
  scheduledEndAt: string;
  actualStartAt: string | null;
  actualEndAt: string | null;
  gracePeriodMinutes: number;
  createdAt: string;
  updatedAt: string;
  examName?: string | null;
  examCode?: string | null;
  subjectName?: string | null;
  batchName?: string | null;
}

export interface ExamBatchDetail extends ExamBatch {
  candidateCount: number;
}

export interface CreateExamBatchInput {
  examId: string;
  batchId?: string | null;
  name: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  gracePeriodMinutes?: number;
  instructions?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface UpdateExamBatchInput extends Partial<CreateExamBatchInput> {}

export interface ExamBatchCandidate {
  id: string;
  candidateId: string;
  assignedAt: string;
  rollNumber: string | null;
  admitCardNumber: string | null;
  userId: string;
  isActive: boolean;
}

export interface ExamBatchAttempt {
  id: string;
  candidateId: string;
  deviceId: string;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
  remainingTimeSecs: number | null;
  isReconnected: boolean;
  reconnectedCount: number;
}

export interface ExamBatchMonitor {
  id: string;
  name: string;
  status: ExamBatchStatus;
  examId: string;
  actualStartAt: string | null;
  actualEndAt: string | null;
  totalCandidates: number;
  attemptStatusBreakdown: Record<string, number>;
}

export interface AssignCandidatesInput {
  candidateIds: string[];
}

export interface CandidateConflict {
  batchId: string;
  batchName: string;
  examId: string;
  examName: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface ConflictingCandidate {
  candidateId: string;
  admitCardNumber: string;
  rollNumber: string | null;
  conflicts: CandidateConflict[];
}

export interface CheckConflictsResponse {
  hasConflicts: boolean;
  conflictingCandidates: ConflictingCandidate[];
}

/* ---------- Candidate Types ---------- */

export interface CandidateListItem {
  id: string;
  userId: string;
  batchId: string | null;
  rollNumber: string | null;
  admitCardNumber: string | null;
  photoUrl: string | null;
  dateOfBirth: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  email: string;
  fullName: string;
  phone: string | null;
  batchName: string | null;
}

export interface CandidateDetail extends CandidateListItem {}

export interface CreateCandidateInput {
  email: string;
  fullName: string;
  dateOfBirth: string;
  batchId?: string | null;
  institutionId?: string | null;
  rollNumber?: string;
  admitCardNumber?: string;
  photoUrl?: string;
  phone?: string;
}

export interface UpdateCandidateInput {
  fullName?: string;
  batchId?: string | null;
  rollNumber?: string;
  admitCardNumber?: string;
  photoUrl?: string;
  phone?: string;
  dateOfBirth?: string;
  isActive?: boolean;
}

export interface BulkImportCandidateRow {
  email: string;
  fullName: string;
  dateOfBirth: string;
  rollNumber?: string;
  admitCardNumber?: string;
  phone?: string;
}

export interface BulkImportInput {
  batchId?: string | null;
  institutionId?: string | null;
  candidates: BulkImportCandidateRow[];
}

export interface BulkImportResult {
  message: string;
  imported: number;
  skipped: number;
}

/* ---------- Device Types ---------- */

export type DeviceStatus =
  | "registered"
  | "active"
  | "suspended"
  | "decommissioned";

export interface DeviceListItem {
  id: string;
  deviceId: string;
  deviceName: string | null;
  macAddress: string;
  hardwareHash: string;
  ipAddress: string | null;
  clientVersion: string | null;
  status: DeviceStatus;
  registeredBy: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceDetail extends DeviceListItem {}

export interface RegisterDeviceInput {
  deviceId: string;
  deviceName?: string;
  macAddress: string;
  hardwareHash: string;
  ipAddress?: string;
}

export interface UpdateDeviceInput {
  deviceName?: string;
  ipAddress?: string;
}

export interface OnlineDevice {
  id: string;
  deviceId: string;
  deviceName: string | null;
  macAddress: string;
  ipAddress: string | null;
  clientVersion: string | null;
  status: DeviceStatus;
  lastSeenAt: string | null;
}

export interface SelfRegisterInput {
  deviceId: string;
  deviceName?: string;
  macAddress: string;
  hardwareHash: string;
  ipAddress?: string;
  clientVersion?: string;
}

export interface ActiveAttempt {
  id: string;
  candidateId: string;
  candidateName: string | null;
  status: string;
  startedAt: string | null;
  remainingTimeSecs: number;
  isReconnected: boolean;
  reconnectedCount: number;
  ipAddress: string | null;
  userAgent: string | null;
  deviceId: string | null;
  deviceName: string | null;
  wsConnected: boolean;
}

export interface ActiveSessionsResponse {
  examBatchId: string;
  activeCount: number;
  attempts: ActiveAttempt[];
  serverTime: number;
}

export interface AttemptState {
  attemptId: string;
  status: string;
  remainingTimeSecs: number;
  answers: Record<
    string,
    {
      answerData: unknown;
      status: string;
      timeSpentSecs: number;
      isMarkedForReview: boolean;
    }
  >;
  serverTime: number;
}
