import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

const CandidateLogin = lazy(() => import("./pages/login"));
const CandidateExamList = lazy(() => import("./pages/exam-list"));
const CandidateExamPage = lazy(() => import("./pages/exam"));

function CandidateProtectedRoute({ children }: { children: React.ReactNode }) {
  const hasToken = !!localStorage.getItem("candidateAccessToken");
  if (!hasToken) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Toaster position="top-right" richColors closeButton />

      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<CandidateLogin />} />
          <Route
            path="/exams"
            element={
              <CandidateProtectedRoute>
                <CandidateExamList />
              </CandidateProtectedRoute>
            }
          />
          <Route
            path="/exam/:id"
            element={
              <CandidateProtectedRoute>
                <CandidateExamPage />
              </CandidateProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
