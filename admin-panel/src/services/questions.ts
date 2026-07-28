import type {
    CreateQuestionInput,
    PaginatedResponse,
    Question,
    QuestionVersion,
} from "../types/index.js";
import api from "./api.js";

export const questionsService = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    subjectId?: string;
    type?: string;
    search?: string;
  }) => api.get<unknown, PaginatedResponse<Question>>("/questions", { params }),

  getById: (id: string) => api.get<unknown, Question>(`/questions/${id}`),

  create: (data: CreateQuestionInput) =>
    api.post<unknown, Question>("/questions", data),

  update: (id: string, data: Partial<CreateQuestionInput>) =>
    api.put<unknown, Question>(`/questions/${id}`, data),

  deactivate: (id: string) =>
    api.delete<unknown, { message: string }>(`/questions/${id}`),

  bulkDelete: (ids: string[]) =>
    api.delete<unknown, { message: string }>(`/questions`, { data: { ids } }),

  sectionWise: (subjectId: string, batchId?: string) =>
    api.get<
      unknown,
      {
        sections: {
          name: string;
          questions: Question[];
        }[];
        unassigned: Question[];
      }
    >(`/questions/section-wise`, { params: { subjectId, batchId } }),

  getVersions: (id: string) =>
    api.get<unknown, { data: QuestionVersion[]; total: number }>(
      `/questions/${id}/versions`,
    ),

  export: (params: {
    format: "json" | "excel" | "pdf";
    subjectId?: string;
    type?: string;
    search?: string;
  }) =>
    api
      .get(`/questions/export`, {
        params,
        responseType: "blob",
      })
      .then((res) => res as unknown as Blob),

  downloadTemplate: () =>
    api
      .get(`/questions/template`, {
        responseType: "blob",
      })
      .then((res) => res as unknown as Blob),

  downloadZipTemplate: () =>
    api
      .get(`/questions/template?format=zip`, {
        responseType: "blob",
      })
      .then((res) => res as unknown as Blob),

  import: (file: File, subjectId: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("subjectId", subjectId);
    return api.post<
      unknown,
      {
        imported: number;
        failed: number;
        total: number;
        errors?: { row: number; error: string }[];
      }
    >(`/questions/import`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  importZip: (file: File, subjectId: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("subjectId", subjectId);
    return api.post<
      unknown,
      {
        imported: number;
        failed: number;
        total: number;
        errors?: { row: number; error: string }[];
      }
    >(`/questions/import-zip`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};
