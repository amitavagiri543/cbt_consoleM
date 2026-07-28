import { queryClient } from "@/main";
import { candidateService, type CandidateExam } from "@/services/candidate";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function CandidateExamList() {
  const navigate = useNavigate();
  const { data: exams, isLoading } = useQuery({
    queryKey: ["candidate-exams"],
    queryFn: candidateService.getExams,
  });

  const handleLogout = async () => {
    // Call backend logout to clear Redis session keys (so the same user
    // can log in fresh on another PC without the old JTI blocking them).
    try {
      await candidateService.logout();
    } catch {
      // Ignore errors — token may already be invalid
    }
    localStorage.removeItem("candidateAccessToken");
    localStorage.removeItem("candidateRefreshToken");
    localStorage.removeItem("candidateUser");
    // Clear all attempt state so the next candidate starts clean
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("exam_attempt_")) {
        localStorage.removeItem(key);
      }
    }
    // Clear React Query cache so the next candidate gets fresh data
    queryClient.clear();
    navigate("/");
  };

  const canStart = (status: string) => status === "active";

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F5F5",
        }}
      >
        <Loader2
          className="h-6 w-6 animate-spin"
          style={{ color: "#1565C0" }}
        />
        <p style={{ fontSize: 13, color: "#757575", marginTop: 12 }}>
          Loading examinations...
        </p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F5F5F5" }}>
      {/* Header */}
      <div
        style={{
          background: "#FFFFFF",
          borderBottom: "1px solid #E0E0E0",
          padding: "16px 32px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Logo */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background:
                  "linear-gradient(135deg, #0D47A1, #1565C0, #1E88E5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ color: "#FFFFFF", fontSize: 20, fontWeight: 700 }}>
                ✓
              </span>
            </div>
            <div>
              <h1
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  color: "#212121",
                  margin: 0,
                }}
              >
                Welcome, <span style={{ fontWeight: 700 }}>{(() => { try { return JSON.parse(localStorage.getItem("candidateUser") ?? "{}").fullName ?? "Candidate"; } catch { return "Candidate"; } })()}</span>
              </h1>
              <p
                style={{
                  fontSize: 13,
                  color: "#757575",
                  marginTop: 2,
                  margin: 0,
                }}
              >
                Your assigned examinations
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#212121", margin: 0 }}>
                {(() => { try { return JSON.parse(localStorage.getItem("candidateUser") ?? "{}").fullName ?? "Candidate"; } catch { return "Candidate"; } })()}
              </p>
              <p style={{ fontSize: 12, color: "#757575", marginTop: 2 }}>
                {(() => { try { return JSON.parse(localStorage.getItem("candidateUser") ?? "{}").admitCardNumber ?? ""; } catch { return ""; } })()}
              </p>
            </div>
            <button
              onClick={handleLogout}
              style={{
                background: "#FFFFFF",
                border: "1px solid #E0E0E0",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 12,
                color: "#757575",
                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "24px 32px", maxWidth: 900 }}>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "#212121",
            marginBottom: 16,
          }}
        >
          Assigned Examinations
        </h2>

        {!exams || exams.length === 0 ? (
          <div
            style={{
              background: "#FFFFFF",
              borderRadius: 8,
              border: "1px solid #E0E0E0",
              padding: 60,
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 16, fontWeight: 500, color: "#212121" }}>
              No exams assigned
            </p>
            <p style={{ fontSize: 13, color: "#757575", marginTop: 4 }}>
              Check back later or contact your administrator.
            </p>
          </div>
        ) : (
          <div>
            {exams.map((exam: CandidateExam) => (
              <div
                key={exam.examBatchId}
                style={{
                  background: "#FFFFFF",
                  borderRadius: 8,
                  border: "1px solid #E0E0E0",
                  marginBottom: 16,
                  boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
                  display: "flex",
                  overflow: "hidden",
                }}
              >
                {/* Left accent */}
                <div
                  style={{
                    width: 6,
                    background: "#1565C0",
                    borderRadius: "8px 0 0 8px",
                    flexShrink: 0,
                  }}
                />
                {/* Info */}
                <div style={{ flex: 1, padding: "18px 12px 18px 20px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 17,
                        fontWeight: 600,
                        color: "#212121",
                      }}
                    >
                      {exam.examName}
                    </span>
                    <span
                      style={{
                        marginLeft: 12,
                        background: "#DFF6DD",
                        borderRadius: 4,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#107C10",
                        textTransform: "capitalize",
                      }}
                    >
                      {exam.status}
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", marginTop: 4 }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        marginRight: 24,
                        marginBottom: 6,
                        fontSize: 13,
                        color: "#757575",
                      }}
                    >
                      <span style={{ fontSize: 14 }}>⏱</span>
                      {exam.durationMinutes} minutes
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        marginRight: 24,
                        marginBottom: 6,
                        fontSize: 13,
                        color: "#757575",
                      }}
                    >
                      <span style={{ fontSize: 14 }}>📝</span>
                      {exam.totalMarks} marks
                    </span>
                    {exam.scheduledAt && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 6,
                          fontSize: 13,
                          color: "#757575",
                        }}
                      >
                        <span style={{ fontSize: 14 }}>📅</span>
                        {new Date(exam.scheduledAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                {/* Start Button */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 20px 0 0",
                  }}
                >
                  <button
                    disabled={!canStart(exam.status)}
                    onClick={() => navigate(`/exam/${exam.examBatchId}`)}
                    style={{
                      background: "#1565C0",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 20px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: canStart(exam.status) ? "pointer" : "default",
                      opacity: canStart(exam.status) ? 1 : 0.4,
                      boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      if (canStart(exam.status))
                        (e.target as HTMLElement).style.background = "#0D47A1";
                    }}
                    onMouseLeave={(e) => {
                      if (canStart(exam.status))
                        (e.target as HTMLElement).style.background = "#1565C0";
                    }}
                  >
                    Start Exam →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
