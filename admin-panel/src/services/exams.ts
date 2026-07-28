import type {
    AddExamQuestionsInput,
    CreateExamInput,
    CreateSectionInput,
    Exam,
    ExamSection,
    PaginatedResponse,
    UpdateExamInput,
} from "../types/index.js";
import api from "./api.js";

export const examsService = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    subjectId?: string;
    institutionId?: string;
  }) => api.get<unknown, PaginatedResponse<Exam>>("/exams", { params }),

  getById: (id: string) => api.get<unknown, Exam>(`/exams/${id}`),

  create: (data: CreateExamInput) => api.post<unknown, Exam>("/exams", data),

  update: (id: string, data: UpdateExamInput) =>
    api.put<unknown, Exam>(`/exams/${id}`, data),

  deactivate: (id: string) =>
    api.delete<unknown, { message: string }>(`/exams/${id}`),

  permanentDelete: (id: string) =>
    api.delete<unknown, { message: string }>(`/exams/${id}/permanent`),

  /* ----- Sections ----- */
  addSection: (examId: string, data: CreateSectionInput) =>
    api.post<unknown, ExamSection>(`/exams/${examId}/sections`, data),

  updateSection: (
    examId: string,
    sectionId: string,
    data: Partial<CreateSectionInput>,
  ) =>
    api.put<unknown, ExamSection>(
      `/exams/${examId}/sections/${sectionId}`,
      data,
    ),

  removeSection: (examId: string, sectionId: string) =>
    api.delete<unknown, { message: string }>(
      `/exams/${examId}/sections/${sectionId}`,
    ),

  /* ----- Exam Questions ----- */
  addQuestions: (
    examId: string,
    sectionId: string,
    data: AddExamQuestionsInput,
  ) =>
    api.post<unknown, { message: string; added: number }>(
      `/exams/${examId}/sections/${sectionId}/questions`,
      data,
    ),

  removeQuestion: (examId: string, sectionId: string, eqId: string) =>
    api.delete<unknown, { message: string }>(
      `/exams/${examId}/sections/${sectionId}/questions/${eqId}`,
    ),

  downloadSectionTemplate: (sections?: string) =>
    api
      .get("/exams/section-template", {
        params: sections ? { sections } : undefined,
        responseType: "blob",
      })
      .then((res) => res as unknown as Blob),

  importQuestions: (examId: string, file: File, subjectId: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("subjectId", subjectId);
    return api.post<
      unknown,
      {
        success: boolean;
        sections: {
          sectionName: string;
          sectionId: string;
          imported: number;
          failed: number;
          errors?: { row: number; error: string }[];
        }[];
        totalImported: number;
        totalFailed: number;
      }
    >(`/exams/${examId}/import-questions`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};
