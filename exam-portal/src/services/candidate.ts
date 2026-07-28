import candidateApi from "./candidate-api.js";

export function generateDeviceFingerprint(): string {
  const parts = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    `${new Date().getTimezoneOffset()}`,
    navigator.hardwareConcurrency?.toString() ?? "0",
    (
      navigator as unknown as { deviceMemory?: number }
    ).deviceMemory?.toString() ?? "0",
    navigator.platform ?? "",
  ];
  let hash = 0;
  const str = parts.join("|");
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(36)}_${str.length}`;
}

export interface CandidateExam {
  examBatchId: string;
  examName: string;
  status: string;
  durationMinutes: number;
  totalMarks: number;
  scheduledAt: string | null;
  instructions: string | null;
  candidateName?: string | null;
  admitCardNumber?: string | null;
  adminContact?: {
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  attemptStatus?: string | null;
  attemptSubmittedAt?: string | null;
  sections?: Array<{
    id: string;
    name: string;
    sectionOrder: number;
    durationMinutes: number | null;
    questionCount: number | null;
    totalMarks: string | null;
  }>;
}

export interface CandidateQuestionOption {
  id: string;
  text: string;
  optionMediaUrl: string | null;
  displayOrder: number;
}

export interface CandidateQuestion {
  id: string;
  sectionId: string;
  type: string;
  displayOrder: number;
  content: {
    text: string;
    latex: string | null;
    passageId: string | null;
    imageUrl: string | null;
    audioUrl: string | null;
    videoUrl: string | null;
  };
  options: CandidateQuestionOption[] | null;
}

export interface ExamStartResponse {
  attemptId: string;
  examBatchId: string;
  status: string;
  startedAt: string;
  durationSeconds: number;
  remainingTimeSeconds: number;
  sections?: Array<{
    id: string;
    name: string;
    sectionOrder: number;
    durationMinutes: number | null;
    questionCount: number | null;
    totalMarks: string | null;
  }>;
}

export const candidateService = {
  login: (
    admitCardNumber: string,
    dateOfBirth: string,
    deviceFingerprint?: string,
  ) =>
    candidateApi.post("/auth/candidate-login", {
      admitCardNumber,
      dateOfBirth,
      deviceFingerprint,
    }),

  logout: () => candidateApi.post("/auth/logout"),

  getExams: async () => {
    const res = await candidateApi.get("/candidate/exams");
    return (res as any).data ?? res;
  },

  getExamMeta: async (batchId: string) => {
    const res = await candidateApi.get(`/candidate/exams/${batchId}`);
    return (res as any).data ?? res;
  },

  getQuestions: async (batchId: string) => {
    const res = await candidateApi.get(`/candidate/exams/${batchId}/questions`);
    return (res as any).data ?? res;
  },

  startExam: async (batchId: string) => {
    const res = await candidateApi.post(`/candidate/exams/${batchId}/start`);
    return (res as any).data ?? res;
  },

  saveAnswer: (
    attemptId: string,
    questionId: string,
    answerData: Record<string, unknown>,
    status: string = "answered",
    timeSpentSecs: number = 0,
    isMarkedForReview: boolean = false,
  ) =>
    candidateApi.post(`/sessions/${attemptId}/answers`, {
      questionId,
      answerData,
      status,
      timeSpentSecs,
      isMarkedForReview,
    }),

  submitExam: (attemptId: string) =>
    candidateApi.post(`/sessions/${attemptId}/submit`),

  getAttemptState: async (attemptId: string) => {
    const res = await candidateApi.get(`/sessions/${attemptId}/state`);
    return (res as any).data ?? res;
  },

  reportViolation: (
    attemptId: string,
    data: {
      violationType: string;
      severity: string;
      description: string;
    },
  ) => candidateApi.post(`/sessions/${attemptId}/violations`, data),

  logEvent: (
    attemptId: string,
    data: {
      eventType: string;
      eventData: unknown;
      severity: string;
    },
  ) => candidateApi.post(`/sessions/${attemptId}/events`, data),
};
