import { candidateService, type CandidateQuestion } from "@/services/candidate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

// ─── Utility Functions ───────────────────────────────────────────────────────

function getQuestionText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const obj = content as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.questionText === "string") return obj.questionText;
  if (typeof obj.question === "string") return obj.question;
  if (typeof obj.statement === "string") return obj.statement;
  return JSON.stringify(obj).slice(0, 200);
}

function getOptions(
  q: CandidateQuestion | undefined,
): Array<{ id: string; label: string }> {
  if (!q || !q.options) return [];
  return q.options.map((opt) => ({
    id: opt.id,
    label: opt.text,
  }));
}

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Calculator Logic ────────────────────────────────────────────────────────

function useCalculator() {
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<string | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [resetNext, setResetNext] = useState(false);

  const press = (btn: string) => {
    if (btn === "C") {
      setDisplay("0");
      setPrev(null);
      setOp(null);
      setResetNext(false);
      return;
    }
    if (btn === "=") {
      if (prev !== null && op) {
        const a = parseFloat(prev);
        const b = parseFloat(display);
        let result = 0;
        if (op === "+") result = a + b;
        else if (op === "-") result = a - b;
        else if (op === "×") result = a * b;
        else if (op === "÷") result = b !== 0 ? a / b : 0;
        setDisplay(String(parseFloat(result.toFixed(8))));
        setPrev(null);
        setOp(null);
        setResetNext(true);
      }
      return;
    }
    if (["+", "-", "×", "÷"].includes(btn)) {
      setPrev(display);
      setOp(btn);
      setResetNext(true);
      return;
    }
    if (btn === ".") {
      if (resetNext) {
        setDisplay("0.");
        setResetNext(false);
        return;
      }
      if (!display.includes(".")) setDisplay(display + ".");
      return;
    }
    // digit
    if (resetNext) {
      setDisplay(btn);
      setResetNext(false);
    } else {
      setDisplay(display === "0" ? btn : display + btn);
    }
  };

  return { display, press };
}

// ─── Main Exam Page Component ────────────────────────────────────────────────

export default function CandidateExamPage() {
  const { id: batchId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [markedForReview, setMarkedForReview] = useState<Set<string>>(
    new Set(),
  );
  const [remainingSecs, setRemainingSecs] = useState(0);
  const [examStarted, setExamStarted] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [forceLogout, setForceLogout] = useState(false);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [serverPaused, setServerPaused] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitStep, setSubmitStep] = useState(0); // 0=hidden, 1=first confirm, 2=second confirm, 3=final confirm
  const [expandedPaletteSections, setExpandedPaletteSections] = useState<
    Set<string>
  >(new Set());
  // Holds a resumable attempt (from a previous session) without auto-starting.
  // The pre-exam screen shows a RESUME button when this is set.
  const [pendingResume, setPendingResume] = useState<{
    attemptId: string;
    remainingSecs: number;
    answers: Record<string, string>;
    lastQId: string | null;
  } | null>(null);

  // Include the candidate's user ID in the storage key so that different
  // candidates on the same browser don't inherit each other's attempt state.
  const candidateUserId = useMemo(() => {
    try {
      const u = JSON.parse(localStorage.getItem("candidateUser") ?? "null");
      return u?.id ?? null;
    } catch {
      return null;
    }
  }, []);
  const storageKey =
    batchId && candidateUserId
      ? `exam_attempt_${candidateUserId}_${batchId}`
      : null;
  const calculator = useCalculator();
  const pendingLastQuestionIdRef = useRef<string | null>(null);

  // Duplicate tab detection using BroadcastChannel
  const [duplicateTab, setDuplicateTab] = useState(false);
  useEffect(() => {
    if (!batchId) return;
    const channelName = `exam_session_${batchId}`;
    const channel = new BroadcastChannel(channelName);

    // Announce this tab is active
    channel.postMessage({ type: "tab_open", timestamp: Date.now() });

    // Listen for other tabs
    channel.onmessage = (event) => {
      if (event.data?.type === "tab_open") {
        // Another tab opened — tell it to close
        channel.postMessage({ type: "tab_exists", timestamp: Date.now() });
      }
      if (event.data?.type === "tab_exists") {
        // This tab is the duplicate — block it
        setDuplicateTab(true);
      }
    };

    return () => {
      channel.close();
    };
  }, [batchId]);

  // Block rendering if duplicate tab detected
  if (duplicateTab) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          padding: 40,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#D32F2F",
            marginBottom: 8,
          }}
        >
          Duplicate Session Detected
        </h1>
        <p style={{ fontSize: 14, color: "#555", maxWidth: 400 }}>
          This exam is already open in another tab or window. Please close this
          tab and continue in the original window.
        </p>
      </div>
    );
  }

  // On mount: check for existing attempt in localStorage and prepare resume
  useEffect(() => {
    if (!storageKey) return;
    const savedAttemptId = localStorage.getItem(storageKey);
    if (savedAttemptId) {
      setResuming(true);
      candidateService
        .getAttemptState(savedAttemptId)
        .then((state) => {
          if (state.status === "in_progress" || state.status === "paused") {
            const restoredAnswers: Record<string, string> = {};
            for (const [qId, ans] of Object.entries(state.answers)) {
              const ansObj = ans as any;
              const answerData = ansObj.answerData as Record<
                string,
                unknown
              > | null;
              if (answerData && typeof answerData === "object") {
                const selected =
                  (answerData as Record<string, unknown>).selectedOptionId ??
                  (answerData as Record<string, unknown>).value ??
                  "";
                if (typeof selected === "string" && selected) {
                  restoredAnswers[qId] = selected;
                }
              }
            }
            const lastQId = localStorage.getItem(`${storageKey}_lastQ`);

            // Detect page refresh vs. fresh navigation from exam list.
            // On refresh ("reload"): auto-resume directly into the exam.
            // On fresh navigation ("navigate"): show the resume/start screen
            //   so the candidate can review before continuing.
            const navEntry = performance.getEntriesByType("navigation")[0] as
              | PerformanceNavigationTiming
              | undefined;
            const isPageRefresh = navEntry?.type === "reload";

            if (isPageRefresh) {
              // Auto-resume directly — this is a refresh during an active exam
              setAnswers(restoredAnswers);
              setAttemptId(savedAttemptId);
              setRemainingSecs(state.remainingTimeSecs);
              if (lastQId) {
                pendingLastQuestionIdRef.current = lastQId;
              }
              setExamStarted(true);
              toast.info("Exam resumed after page refresh.");
              // SSE connection will open and auto-resume the attempt on the
              // backend (the SSE endpoint calls autoResumeAttempt on connect).
            } else {
              // Fresh navigation from exam list — show the resume screen
              setPendingResume({
                attemptId: savedAttemptId,
                remainingSecs: state.remainingTimeSecs,
                answers: restoredAnswers,
                lastQId,
              });
            }
          } else if (
            state.status === "submitted" ||
            state.status === "auto_submitted" ||
            state.status === "force_submitted" ||
            state.status === "terminated"
          ) {
            // Exam already submitted — show submitted screen, clear localStorage
            localStorage.removeItem(storageKey);
            localStorage.removeItem(`${storageKey}_lastQ`);
            setExamSubmitted(true);
          } else {
            localStorage.removeItem(storageKey);
            localStorage.removeItem(`${storageKey}_lastQ`);
          }
        })
        .catch(() => {
          localStorage.removeItem(storageKey);
          localStorage.removeItem(`${storageKey}_lastQ`);
        })
        .finally(() => setResuming(false));
    }
  }, [storageKey]);

  // Apply a pending resume: restore answers, attemptId, timer, and start the exam.
  const handleResume = async () => {
    if (!pendingResume) return;
    // Re-validate attempt state before resuming — the attempt may have been
    // submitted (e.g., auto-submitted by timer) since the resume screen was shown
    try {
      const state = await candidateService.getAttemptState(
        pendingResume.attemptId,
      );
      if (
        state.status === "submitted" ||
        state.status === "auto_submitted" ||
        state.status === "force_submitted" ||
        state.status === "terminated"
      ) {
        if (storageKey) {
          localStorage.removeItem(storageKey);
          localStorage.removeItem(`${storageKey}_lastQ`);
        }
        setPendingResume(null);
        setExamSubmitted(true);
        toast.info("This exam has already been submitted.");
        return;
      }
    } catch {
      // If state check fails, proceed with resume anyway
    }
    setAnswers(pendingResume.answers);
    setAttemptId(pendingResume.attemptId);
    setRemainingSecs(pendingResume.remainingSecs);
    if (pendingResume.lastQId) {
      pendingLastQuestionIdRef.current = pendingResume.lastQId;
    }
    setExamStarted(true);
    setPendingResume(null);
    toast.info("Exam resumed from previous session.");
    // SSE connection will open and auto-resume on the backend.
  };

  const { data: examMeta } = useQuery({
    queryKey: ["candidate-exam-meta", batchId],
    queryFn: () => candidateService.getExamMeta(batchId!),
    enabled: !!batchId,
  });

  const { data: questions, isLoading: questionsLoading } = useQuery({
    queryKey: ["candidate-questions", batchId],
    queryFn: () => candidateService.getQuestions(batchId!),
    enabled: !!batchId,
  });

  const startExamMutation = useMutation({
    mutationFn: () => candidateService.startExam(batchId!),
    onSuccess: (data) => {
      setAttemptId(data.attemptId);
      setRemainingSecs(data.remainingTimeSeconds);
      setExamStarted(true);
      if (storageKey) localStorage.setItem(storageKey, data.attemptId);
      if (data.status === "in_progress" || data.status === "paused") {
        candidateService
          .getAttemptState(data.attemptId)
          .then((state) => {
            const restoredAnswers: Record<string, string> = {};
            for (const [qId, ans] of Object.entries(state.answers)) {
              const ansObj = ans as any;
              const answerData = ansObj.answerData as Record<
                string,
                unknown
              > | null;
              if (answerData && typeof answerData === "object") {
                const selected =
                  (answerData as Record<string, unknown>).selectedOptionId ??
                  (answerData as Record<string, unknown>).value ??
                  "";
                if (typeof selected === "string" && selected) {
                  restoredAnswers[qId] = selected;
                }
              }
            }
            setAnswers(restoredAnswers);
            setRemainingSecs(state.remainingTimeSecs);
            toast.info("Exam resumed — answers restored.");
          })
          .catch(() => {
            toast.success("Exam started. Good luck!");
          });
      } else {
        toast.success("Exam started. Good luck!");
      }
    },
    onError: (err: any) => {
      const errData = err.response?.data?.error;
      const msg =
        typeof errData === "string"
          ? errData
          : (errData?.message ?? "Failed to start exam");
      // If exam already submitted, show submitted screen instead of error toast
      if (
        typeof msg === "string" &&
        msg.toLowerCase().includes("already submitted")
      ) {
        if (storageKey) {
          localStorage.removeItem(storageKey);
          localStorage.removeItem(`${storageKey}_lastQ`);
        }
        setExamSubmitted(true);
        setPendingResume(null);
      } else {
        toast.error(msg);
      }
    },
  });

  const saveAnswerMutation = useMutation({
    mutationFn: ({
      questionId,
      answerData,
    }: {
      questionId: string;
      answerData: Record<string, unknown>;
    }) => candidateService.saveAnswer(attemptId!, questionId, answerData),
    onError: () => {},
  });

  const handleAnswerSelect = (
    questionId: string,
    answerData: Record<string, unknown>,
    displayValue: string,
  ) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: displayValue };
      saveAnswerMutation.mutate({ questionId, answerData });
      return next;
    });
  };

  const handleClearAnswer = () => {
    if (!currentQuestion) return;
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[currentQuestion.id];
      return next;
    });
  };

  const handleMarkForReview = () => {
    if (!currentQuestion) return;
    setMarkedForReview((prev) => {
      const next = new Set(prev);
      if (next.has(currentQuestion.id)) next.delete(currentQuestion.id);
      else next.add(currentQuestion.id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!attemptId) return;
    setSubmitting(true);
    // Close SSE immediately to prevent auto-pause/resume events interfering
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    try {
      await candidateService.submitExam(attemptId);
      if (storageKey) {
        localStorage.removeItem(storageKey);
        localStorage.removeItem(`${storageKey}_lastQ`);
      }
      toast.success("Exam submitted successfully!");
      queryClient.invalidateQueries({ queryKey: ["candidate-exams"] });
      queryClient.invalidateQueries({
        queryKey: ["candidate-exam-meta", batchId],
      });
      setExamSubmitted(true);
    } catch (err: any) {
      const errData = err.response?.data?.error;
      const msg =
        typeof errData === "string"
          ? errData
          : (errData?.message ?? "Submit failed");
      // If the error is "already submitted", the backend processed it — show submitted screen
      if (
        typeof msg === "string" &&
        msg.toLowerCase().includes("already submitted")
      ) {
        if (storageKey) {
          localStorage.removeItem(storageKey);
          localStorage.removeItem(`${storageKey}_lastQ`);
        }
        setExamSubmitted(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
      setShowSubmitDialog(false);
    }
  };

  // Timer countdown
  const timeExpiredRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!examStarted || remainingSecs <= 0 || timeExpiredRef.current) return;
    const timer = setInterval(() => {
      setRemainingSecs((s) => {
        if (s <= 1) {
          clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [examStarted]);

  // Auto-submit when time reaches 0
  useEffect(() => {
    if (
      remainingSecs === 0 &&
      examStarted &&
      attemptId &&
      !timeExpiredRef.current
    ) {
      timeExpiredRef.current = true;
      // Close SSE to prevent interference
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      toast.error("Time is up! Auto-submitting your exam...");
      candidateService
        .submitExam(attemptId)
        .then(() => {
          if (storageKey) {
            localStorage.removeItem(storageKey);
            localStorage.removeItem(`${storageKey}_lastQ`);
          }
          queryClient.invalidateQueries({ queryKey: ["candidate-exams"] });
          queryClient.invalidateQueries({
            queryKey: ["candidate-exam-meta", batchId],
          });
          setExamSubmitted(true);
        })
        .catch(() => {
          // Backend timer will auto-submit anyway
          if (storageKey) {
            localStorage.removeItem(storageKey);
            localStorage.removeItem(`${storageKey}_lastQ`);
          }
          queryClient.invalidateQueries({
            queryKey: ["candidate-exam-meta", batchId],
          });
          setExamSubmitted(true);
        });
    }
  }, [remainingSecs, examStarted, attemptId]);

  // Violation detection
  useEffect(() => {
    if (!examStarted || !attemptId) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        candidateService
          .reportViolation(attemptId, {
            violationType: "tab_switch",
            severity: "high",
            description: "Candidate switched away from the exam tab",
          })
          .catch(() => {});
        toast.warning("Tab switch detected! This has been reported.");
      }
    };
    const handleBlur = () => {
      candidateService
        .reportViolation(attemptId, {
          violationType: "window_blur",
          severity: "medium",
          description: "Exam window lost focus",
        })
        .catch(() => {});
      toast.warning("Window focus lost! This has been reported.");
    };
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      candidateService
        .reportViolation(attemptId, {
          violationType: "process_violation",
          severity: "low",
          description: "Right-click context menu blocked",
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("contextmenu", handleContextMenu);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [examStarted, attemptId]);

  // SSE connection — real-time session updates from the server.
  // The server pushes events in real-time: pause, resume, terminate, etc.
  // The connection itself serves as the liveness signal — when it drops
  // (tab closed, network lost), the server auto-pauses the attempt.
  useEffect(() => {
    if (!examStarted || !attemptId || forceLogout) return;

    const token = localStorage.getItem("candidateAccessToken");
    if (!token) return;

    // EventSource doesn't support custom headers, so pass token as query param
    const eventSource = new EventSource(
      `/api/sse/candidate?token=${encodeURIComponent(token)}`,
    );
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("session:active", (e: any) => {
      setServerPaused(false);
      try {
        const data = JSON.parse(e.data);
        if (data.remainingTimeSecs != null && data.serverTime != null) {
          const drift = Math.floor((Date.now() - data.serverTime) / 1000);
          setRemainingSecs(Math.max(0, data.remainingTimeSecs - drift));
        }
      } catch {}
    });

    eventSource.addEventListener("session:auto_resumed", (e: any) => {
      setServerPaused(false);
      toast.success("Connection restored.");
      try {
        const data = JSON.parse(e.data);
        if (data.remainingTimeSecs != null && data.serverTime != null) {
          const drift = Math.floor((Date.now() - data.serverTime) / 1000);
          setRemainingSecs(Math.max(0, data.remainingTimeSecs - drift));
        }
      } catch {}
    });

    eventSource.addEventListener("session:paused", (e: any) => {
      setServerPaused(true);
      try {
        const data = JSON.parse(e.data);
        if (data.remainingTimeSecs != null)
          setRemainingSecs(data.remainingTimeSecs);
      } catch {}
    });

    eventSource.addEventListener("session:auto_paused", (e: any) => {
      setServerPaused(true);
      try {
        const data = JSON.parse(e.data);
        if (data.remainingTimeSecs != null)
          setRemainingSecs(data.remainingTimeSecs);
      } catch {}
    });

    eventSource.addEventListener("session:resumed", (e: any) => {
      setServerPaused(false);
      try {
        const data = JSON.parse(e.data);
        if (data.remainingTimeSecs != null && data.serverTime != null) {
          const drift = Math.floor((Date.now() - data.serverTime) / 1000);
          setRemainingSecs(Math.max(0, data.remainingTimeSecs - drift));
        }
      } catch {}
    });

    eventSource.addEventListener("session:terminated", () => {
      setForceLogout(true);
      toast.error("Exam has been stopped by the administrator.");
    });

    eventSource.addEventListener("session:submitted", () => {
      setExamSubmitted(true);
      if (storageKey) {
        localStorage.removeItem(storageKey);
        localStorage.removeItem(`${storageKey}_lastQ`);
      }
    });

    eventSource.addEventListener("session:auto_submitted", () => {
      setExamSubmitted(true);
      if (storageKey) {
        localStorage.removeItem(storageKey);
        localStorage.removeItem(`${storageKey}_lastQ`);
      }
    });

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    eventSource.onerror = () => {
      // Connection lost — don't immediately show paused.
      // EventSource auto-reconnects. Only show paused if reconnection
      // doesn't happen within 5 seconds (network truly down).
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        setServerPaused(true);
      }, 5000);
    };

    eventSource.onopen = () => {
      // Connection established (or reconnected) — clear paused state
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setServerPaused(false);
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [examStarted, attemptId, forceLogout]);

  // Close SSE on pagehide — ensures backend gets immediate close event
  // even on mobile browsers that keep connections alive in background
  useEffect(() => {
    if (!examStarted || !attemptId) return;
    const handlePageHide = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [examStarted, attemptId]);

  // Force logout
  useEffect(() => {
    if (!forceLogout) return;
    // Call backend logout to clear Redis session keys
    candidateService.logout().catch(() => {});
    localStorage.removeItem("candidateAccessToken");
    localStorage.removeItem("candidateRefreshToken");
    localStorage.removeItem("candidateDeviceFp");
    localStorage.removeItem("candidateUser");
    if (storageKey) {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(`${storageKey}_lastQ`);
    }
    const timer = setTimeout(() => navigate("/"), 2000);
    return () => clearTimeout(timer);
  }, [forceLogout, navigate, storageKey]);

  // Section management
  const sections = useMemo(() => {
    if (!questions || !examMeta?.sections) return [];
    return examMeta.sections.map((s: any) => ({
      ...s,
      questions: questions.filter((q: any) => q.sectionId === s.id),
    }));
  }, [questions, examMeta]);

  useEffect(() => {
    if (!activeSectionId && sections.length > 0) {
      setActiveSectionId(sections[0].id);
      setCurrentIndex(0);
    }
  }, [sections, activeSectionId]);

  // Restore last question position after questions load
  useEffect(() => {
    const lastQId = pendingLastQuestionIdRef.current;
    if (
      !lastQId ||
      !questions ||
      questions.length === 0 ||
      sections.length === 0
    )
      return;

    // Find which section and index this question belongs to
    for (const section of sections) {
      const sectionQuestions = questions.filter(
        (q: any) => q.sectionId === section.id,
      );
      const qIndex = sectionQuestions.findIndex((q: any) => q.id === lastQId);
      if (qIndex >= 0) {
        setActiveSectionId(section.id);
        setCurrentIndex(qIndex);
        pendingLastQuestionIdRef.current = null;
        break;
      }
    }
  }, [questions, sections]);

  const activeSectionQuestions = useMemo(() => {
    if (!activeSectionId || !questions) return [];
    return questions.filter((q: any) => q.sectionId === activeSectionId);
  }, [activeSectionId, questions]);

  const activeSection = sections.find((s: any) => s.id === activeSectionId);
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);
  const unansweredCount = (questions?.length ?? 0) - answeredCount;
  const totalQuestions = questions?.length ?? 0;
  const currentQuestion = activeSectionQuestions[currentIndex];
  const markedCount = markedForReview.size;

  // Persist current question position to localStorage
  useEffect(() => {
    if (currentQuestion && storageKey) {
      localStorage.setItem(`${storageKey}_lastQ`, currentQuestion.id);
    }
  }, [currentQuestion, storageKey]);

  const isFirstQuestion =
    currentIndex === 0 &&
    sections.findIndex((s: any) => s.id === activeSectionId) === 0;
  const isLastQuestion =
    currentIndex === activeSectionQuestions.length - 1 &&
    sections.findIndex((s: any) => s.id === activeSectionId) ===
      sections.length - 1;

  const handleNext = () => {
    if (currentIndex < activeSectionQuestions.length - 1)
      setCurrentIndex((i) => i + 1);
    else {
      const idx = sections.findIndex((s: any) => s.id === activeSectionId);
      if (idx < sections.length - 1) {
        setActiveSectionId(sections[idx + 1].id);
        setCurrentIndex(0);
      }
    }
  };
  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
    else {
      const idx = sections.findIndex((s: any) => s.id === activeSectionId);
      if (idx > 0) {
        setActiveSectionId(sections[idx - 1].id);
        setCurrentIndex(sections[idx - 1].questions.length - 1);
      }
    }
  };

  // ═══ OVERLAYS ═══

  if (examSubmitted) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F5F5",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "#E8F5E9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 32, color: "#2E7D32" }}>✓</span>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "#212121" }}>
          Exam Submitted
        </h1>
        <p style={{ fontSize: 14, color: "#757575" }}>
          Your exam has been submitted successfully.
        </p>
        <button
          onClick={() => navigate("/exams")}
          style={{
            background: "#1565C0",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 6,
            padding: "10px 24px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            marginTop: 8,
          }}
        >
          Back to Exam List
        </button>
      </div>
    );
  }

  if (forceLogout) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F5F5",
        }}
      >
        <div style={{ width: 400, textAlign: "center" }}>
          <span style={{ fontSize: 64, color: "#E53935" }}>⚠</span>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#212121",
              marginTop: 20,
            }}
          >
            Session Terminated
          </h2>
          <p style={{ fontSize: 14, color: "#757575", marginTop: 15 }}>
            You are being redirected to the login page...
          </p>
        </div>
      </div>
    );
  }

  if (serverPaused && examStarted) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F5F5",
        }}
      >
        <div style={{ width: 400, textAlign: "center" }}>
          <span style={{ fontSize: 48, color: "#FFA726" }}>⚠</span>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#212121",
              marginTop: 20,
            }}
          >
            Exam Paused
          </h2>
          <p style={{ fontSize: 14, color: "#757575", marginTop: 10 }}>
            Connection to server lost. Your timer is paused. Reconnecting...
          </p>
          <Loader2
            className="mx-auto mt-4 h-6 w-6 animate-spin"
            style={{ color: "#1565C0" }}
          />
        </div>
      </div>
    );
  }

  if (!examStarted && resuming) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F5F5",
        }}
      >
        <div style={{ width: 400, textAlign: "center" }}>
          <Loader2
            className="mx-auto h-8 w-8 animate-spin"
            style={{ color: "#1565C0" }}
          />
          <h2
            style={{
              fontSize: 18,
              fontWeight: 500,
              color: "#212121",
              marginTop: 16,
            }}
          >
            Restoring your exam session...
          </h2>
          <p style={{ fontSize: 14, color: "#757575", marginTop: 8 }}>
            Reconnecting to server and restoring your answers.
          </p>
        </div>
      </div>
    );
  }

  // ═══ EXAM ALREADY SUBMITTED ═══
  if (
    !examStarted &&
    !resuming &&
    (examMeta?.attemptStatus === "submitted" ||
      examMeta?.attemptStatus === "auto_submitted" ||
      examMeta?.attemptStatus === "force_submitted")
  ) {
    const submittedDate = examMeta?.attemptSubmittedAt
      ? new Date(examMeta.attemptSubmittedAt).toLocaleString()
      : null;
    const candidateName =
      examMeta?.candidateName ??
      (() => {
        try {
          const u = JSON.parse(localStorage.getItem("candidateUser") ?? "null");
          return u?.fullName ?? null;
        } catch {
          return null;
        }
      })();

    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F5F5",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            background: "#FFFFFF",
            borderRadius: 10,
            border: "1px solid #E0E0E0",
            padding: 40,
            textAlign: "center",
            boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
          }}
        >
          {/* Success icon */}
          <div
            style={{
              display: "inline-flex",
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "#E8F5E9",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <span style={{ fontSize: 36, color: "#2E7D32" }}>✓</span>
          </div>

          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#212121",
              marginBottom: 8,
            }}
          >
            Exam Submitted
          </h1>
          <p style={{ fontSize: 15, color: "#757575", marginBottom: 24 }}>
            {examMeta?.examName ?? "This exam"} has already been submitted.
          </p>

          {/* Candidate info */}
          <div
            style={{
              border: "1px solid #E0E0E0",
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
              textAlign: "left",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 13, color: "#757575" }}>Candidate</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#212121" }}>
                {candidateName ?? "—"}
              </span>
            </div>
            {submittedDate && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 13, color: "#757575" }}>
                  Submitted At
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#212121",
                  }}
                >
                  {submittedDate}
                </span>
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 13, color: "#757575" }}>
                Total Marks
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#212121" }}>
                {examMeta?.totalMarks ?? "—"}
              </span>
            </div>
          </div>

          <div
            style={{
              background: "#E3F2FD",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 24,
            }}
          >
            <p style={{ fontSize: 13, color: "#1565C0", margin: 0 }}>
              Your answers have been recorded. Results will be announced by your
              administrator. Please contact the admin if you have any questions.
            </p>
          </div>

          <button
            onClick={() => navigate("/exams")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: 44,
              background: "#1565C0",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Back to Exam List
          </button>
        </div>
      </div>
    );
  }

  // ═══ PRE-EXAM INSTRUCTIONS ═══
  if (!examStarted) {
    const candidateName =
      examMeta?.candidateName ??
      (() => {
        try {
          const u = JSON.parse(localStorage.getItem("candidateUser") ?? "null");
          return u?.fullName ?? null;
        } catch {
          return null;
        }
      })();
    const isResume =
      !!pendingResume ||
      examMeta?.attemptStatus === "paused" ||
      examMeta?.attemptStatus === "in_progress";
    const displayTimeSecs = pendingResume
      ? pendingResume.remainingSecs
      : examMeta?.attemptStatus === "paused" ||
          examMeta?.attemptStatus === "in_progress"
        ? (examMeta?.attemptRemainingTimeSecs ??
          (examMeta?.durationMinutes ?? 0) * 60)
        : (examMeta?.durationMinutes ?? 0) * 60;

    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#F5F5F5",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 720,
            background: "#FFFFFF",
            borderRadius: 10,
            border: "1px solid #E0E0E0",
            padding: 32,
            marginTop: 32,
            boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
          }}
        >
          {/* Header banner */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              paddingBottom: 20,
              borderBottom: "1px solid #E0E0E0",
              marginBottom: 20,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                width: 52,
                height: 52,
                borderRadius: 12,
                background:
                  "linear-gradient(135deg, #0D47A1, #1565C0, #1E88E5)",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 24, color: "#FFFFFF", fontWeight: 700 }}>
                ✓
              </span>
            </div>
            <div style={{ flex: 1 }}>
              <h1
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#212121",
                  margin: 0,
                }}
              >
                {examMeta?.examName ?? "Exam"}
              </h1>
              <p style={{ fontSize: 13, color: "#757575", margin: "4px 0 0" }}>
                {isResume
                  ? "Resume your in-progress exam session"
                  : "Review the details and rules before you begin"}
              </p>
            </div>
            {isResume && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#FFFFFF",
                  background: "#FFA726",
                  padding: "4px 10px",
                  borderRadius: 12,
                }}
              >
                RECONNECT
              </span>
            )}
          </div>

          {/* Candidate + admin info */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 14,
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  color: "#757575",
                  margin: 0,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Candidate
              </p>
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#212121",
                  margin: "4px 0 0",
                }}
              >
                {candidateName ?? "—"}
              </p>
            </div>
            <div
              style={{
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 14,
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  color: "#757575",
                  margin: 0,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Admit Card Number
              </p>
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#212121",
                  margin: "4px 0 0",
                }}
              >
                {examMeta?.admitCardNumber ?? "—"}
              </p>
            </div>
          </div>

          {/* Time + questions summary */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                background: isResume ? "#FFF3E0" : "#E3F2FD",
                borderRadius: 8,
                padding: 16,
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: isResume ? "#E65100" : "#1565C0",
                  margin: 0,
                }}
              >
                {formatTime(displayTimeSecs)}
              </p>
              <p style={{ fontSize: 11, color: "#757575", margin: "4px 0 0" }}>
                {isResume ? "Time Remaining" : "Duration"}
              </p>
            </div>
            <div
              style={{
                background: "#E8F5E9",
                borderRadius: 8,
                padding: 16,
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#212121",
                  margin: 0,
                }}
              >
                {totalQuestions || "—"}
              </p>
              <p style={{ fontSize: 11, color: "#757575", margin: "4px 0 0" }}>
                Questions
              </p>
            </div>
            <div
              style={{
                background: "#F3E5F5",
                borderRadius: 8,
                padding: 16,
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#212121",
                  margin: 0,
                }}
              >
                {examMeta?.totalMarks ?? "—"}
              </p>
              <p style={{ fontSize: 11, color: "#757575", margin: "4px 0 0" }}>
                Total Marks
              </p>
            </div>
          </div>

          {/* Scheduled time (fresh start only) */}
          {!isResume && examMeta?.scheduledAt && (
            <div
              style={{
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 14,
                marginBottom: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 13, color: "#757575" }}>
                Scheduled Start
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#212121" }}>
                {new Date(examMeta.scheduledAt).toLocaleString()}
              </span>
            </div>
          )}

          {/* Sections */}
          {sections.length > 0 && (
            <div
              style={{
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#212121",
                  marginBottom: 10,
                }}
              >
                Sections
              </h3>
              {sections.map((s: any, i: number) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                    padding: "6px 0",
                    borderTop: i > 0 ? "1px solid #F5F5F5" : "none",
                  }}
                >
                  <span style={{ color: "#212121" }}>
                    {i + 1}. {s.name}
                  </span>
                  <span style={{ color: "#757575" }}>
                    {s.questions.length} questions
                    {s.durationMinutes ? ` · ${s.durationMinutes} min` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Rules & Terms */}
          <div
            style={{
              border: "1px solid #E0E0E0",
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
            }}
          >
            <h3
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#212121",
                marginBottom: 10,
              }}
            >
              Rules &amp; Terms
            </h3>
            <ul
              style={{
                fontSize: 13,
                color: "#424242",
                margin: 0,
                paddingLeft: 20,
                lineHeight: 1.7,
              }}
            >
              <li>
                {isResume
                  ? "Your previous answers have been restored. The timer will continue from where it left off."
                  : "Once you start, the timer cannot be paused."}
              </li>
              <li>Your answers are auto-saved as you go.</li>
              <li>Do not close or refresh the browser during the exam.</li>
              <li>
                Switching tabs, opening other apps, or leaving fullscreen may be
                flagged as a violation.
              </li>
              <li>The exam will auto-submit when the timer reaches zero.</li>
              <li>
                Any technical issues — contact your administrator or invigilator
                immediately.
              </li>
            </ul>
          </div>

          {/* Exam-specific instructions */}
          {examMeta?.instructions && (
            <div
              style={{
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#212121",
                  marginBottom: 8,
                }}
              >
                Instructions
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "#757575",
                  whiteSpace: "pre-wrap",
                }}
              >
                {typeof examMeta.instructions === "string"
                  ? examMeta.instructions
                  : ((examMeta.instructions as any)?.text ?? "")}
              </p>
            </div>
          )}

          {/* Warning */}
          <div
            style={{
              background: "#FFF8E1",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 20,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <span style={{ fontSize: 16, color: "#E65100" }}>⚠</span>
            <p style={{ fontSize: 13, color: "#E65100", margin: 0 }}>
              {isResume
                ? "Clicking RESUME will restart the timer from your remaining time. Do not proceed unless you are ready."
                : "Once you start, the timer cannot be paused. Your answers are auto-saved. Do not close or refresh the browser."}
            </p>
          </div>

          {/* Action button: START (fresh) or RESUME (reconnect) */}
          <button
            onClick={() =>
              pendingResume ? handleResume() : startExamMutation.mutate()
            }
            disabled={
              (pendingResume ? false : startExamMutation.isPending) ||
              questionsLoading
            }
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: 48,
              background: isResume ? "#2E7D32" : "#1565C0",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
              cursor:
                (isResume ? false : startExamMutation.isPending) ||
                questionsLoading
                  ? "default"
                  : "pointer",
              opacity:
                (isResume ? false : startExamMutation.isPending) ||
                questionsLoading
                  ? 0.7
                  : 1,
            }}
          >
            {!isResume && startExamMutation.isPending && (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            )}
            {isResume
              ? "Resume Exam"
              : startExamMutation.isPending
                ? "Starting..."
                : "Start Exam"}
          </button>

          {/* Cancel / back link */}
          <button
            onClick={() => navigate("/exams")}
            style={{
              display: "block",
              margin: "12px auto 0",
              background: "none",
              border: "none",
              color: "#757575",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Back to exam list
          </button>
        </div>
      </div>
    );
  }

  // ═══ LOADING ═══
  if (questionsLoading || !questions) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F5F5",
        }}
      >
        <Loader2
          className="h-8 w-8 animate-spin"
          style={{ color: "#1565C0" }}
        />
      </div>
    );
  }

  // ═══ MAIN EXAM INTERFACE ═══
  // Layout: Row 0 = Header (spans both cols), Row 1 = Question + Sidebar, Row 2 = Footer (left col only)
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        gridTemplateColumns: "1fr 290px",
        height: "100vh",
        overflow: "hidden",
        background: "#F5F5F5",
      }}
    >
      {/* ═══ ROW 0: HEADER - Blue bar spanning both columns ═══ */}
      <div
        style={{
          gridColumn: "1 / -1",
          background: "#1565C0",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Left: Logo + Exam Title + Candidate/Section info */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo placeholder 28x28 */}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 4,
              background: "#0D47A1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ color: "#FFFFFF", fontSize: 14, fontWeight: 700 }}>
              E
            </span>
          </div>
          <div>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#FFFFFF" }}>
              {examMeta?.examName ?? "Exam"}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginLeft: 12,
              }}
            >
              {activeSection ? activeSection.name : ""}
            </span>
          </div>
        </div>

        {/* Right: Candidate info + Connection dot + Timer */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Candidate Name & Admit Number */}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF" }}>
              {examMeta?.candidateName ?? ""}
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(255,255,255,0.75)",
              }}
            >
              {examMeta?.admitCardNumber ?? ""}
            </div>
          </div>
          {/* Connection status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#4CAF50",
              }}
            />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
              Online
            </span>
          </div>
          {/* Timer box */}
          <div
            style={{
              background: "#FFF8E1",
              borderRadius: 6,
              padding: "6px 12px",
            }}
          >
            <span
              style={{
                fontSize: 17,
                fontWeight: 700,
                fontFamily: "Consolas, monospace",
                color: "#E65100",
              }}
            >
              {formatTime(remainingSecs)}
            </span>
          </div>
        </div>
      </div>

      {/* ═══ ROW 1, COL 1: QUESTION CONTENT (left area, scrollable) ═══ */}
      <div
        style={{
          overflow: "auto",
          padding: "24px 20px 20px 12px",
          paddingLeft: 24,
        }}
      >
        {/* Question number badge + Marks badge */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <span
            style={{
              background: "#E3F2FD",
              borderRadius: 4,
              padding: "5px 10px",
              fontSize: 12,
              fontWeight: 600,
              color: "#1565C0",
            }}
          >
            Question {currentIndex + 1} of {activeSectionQuestions.length}
          </span>
          <span
            style={{
              background: "#F5F5F5",
              borderRadius: 4,
              padding: "5px 10px",
              fontSize: 12,
              color: "#757575",
            }}
          >
            Marks: +1 / -0
          </span>
        </div>

        {/* Question text */}
        <p
          style={{
            fontSize: 16,
            lineHeight: "26px",
            color: "#212121",
            marginBottom: 24,
            whiteSpace: "pre-wrap",
          }}
        >
          {getQuestionText(currentQuestion?.content)}
        </p>

        {/* MCQ Options */}
        {currentQuestion && getOptions(currentQuestion).length > 0 && (
          <div>
            {getOptions(currentQuestion).map((opt) => {
              const isSelected = answers[currentQuestion.id] === opt.id;
              return (
                <div
                  key={opt.id}
                  onClick={() =>
                    handleAnswerSelect(
                      currentQuestion.id,
                      { selectedOptionId: opt.id },
                      opt.id,
                    )
                  }
                  style={{
                    margin: "4px 0",
                    borderRadius: 6,
                    border: isSelected
                      ? "1.5px solid #1565C0"
                      : "1px solid #E0E0E0",
                    background: isSelected ? "#E3F2FD" : "#FFFFFF",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "14px 12px",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name={`q-${currentQuestion.id}`}
                      checked={isSelected}
                      onChange={() =>
                        handleAnswerSelect(
                          currentQuestion.id,
                          { selectedOptionId: opt.id },
                          opt.id,
                        )
                      }
                      style={{ width: 16, height: 16, accentColor: "#1565C0" }}
                    />
                    <span style={{ fontSize: 15, color: "#212121" }}>
                      {opt.label}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        )}

        {/* Free text input */}
        {currentQuestion && getOptions(currentQuestion).length === 0 && (
          <div>
            <p style={{ fontSize: 14, color: "#757575", marginBottom: 8 }}>
              Your Answer:
            </p>
            <textarea
              rows={6}
              placeholder="Type your answer here..."
              value={answers[currentQuestion.id] ?? ""}
              onChange={(e) =>
                handleAnswerSelect(
                  currentQuestion.id,
                  { textInput: e.target.value },
                  e.target.value,
                )
              }
              style={{
                width: "100%",
                fontSize: 15,
                padding: 12,
                border: "1px solid #E0E0E0",
                borderRadius: 6,
                outline: "none",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}
      </div>

      {/* ═══ ROW 1, COL 2: RIGHT SIDEBAR (290px) ═══ */}
      <div
        style={{
          background: "#FAFAFA",
          borderLeft: "1px solid #E0E0E0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Scrollable content area */}
        <div style={{ flex: 1, overflow: "auto", margin: 16 }}>
          {/* 1. Question Palette — grouped by section with collapsible */}
          <div style={{ marginBottom: 16 }}>
            <h4
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#212121",
                marginBottom: 8,
              }}
            >
              Question Palette
            </h4>
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 10,
                maxHeight: 440,
                overflow: "auto",
              }}
            >
              {sections.map((section: any) => {
                const sectionQs =
                  questions?.filter((q: any) => q.sectionId === section.id) ??
                  [];
                const isActiveSection = section.id === activeSectionId;
                const isExpanded =
                  expandedPaletteSections.has(section.id) || isActiveSection;
                return (
                  <div key={section.id} style={{ marginBottom: 6 }}>
                    <div
                      onClick={() => {
                        setExpandedPaletteSections((prev) => {
                          const next = new Set(prev);
                          if (next.has(section.id)) next.delete(section.id);
                          else next.add(section.id);
                          return next;
                        });
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 11,
                        fontWeight: 700,
                        color: isActiveSection ? "#1565C0" : "#616161",
                        cursor: "pointer",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        padding: "5px 4px",
                        background: isActiveSection ? "#E3F2FD" : "#F5F5F5",
                        borderRadius: 4,
                      }}
                    >
                      <span>
                        {section.name} (
                        {sectionQs.filter((q: any) => !!answers[q.id]).length}/
                        {sectionQs.length})
                      </span>
                      <span
                        style={{
                          fontSize: 14,
                          transition: "transform 0.2s",
                          transform: isExpanded
                            ? "rotate(180deg)"
                            : "rotate(0deg)",
                        }}
                      >
                        ▾
                      </span>
                    </div>
                    {isExpanded && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          paddingTop: 6,
                        }}
                      >
                        {sectionQs.map((q: any, i: number) => {
                          const isActive =
                            isActiveSection && i === currentIndex;
                          const isAnswered = !!answers[q.id];
                          const isMarked = markedForReview.has(q.id);

                          let bg = "#EF5350";
                          if (isActive) bg = "#1976D2";
                          else if (isMarked) bg = "#FFA726";
                          else if (isAnswered) bg = "#66BB6A";

                          return (
                            <button
                              key={q.id}
                              onClick={() => {
                                setActiveSectionId(section.id);
                                setCurrentIndex(i);
                              }}
                              style={{
                                width: 32,
                                height: 32,
                                margin: 2,
                                border: "none",
                                borderRadius: 5,
                                fontSize: 11,
                                fontWeight: 700,
                                background: bg,
                                color: "#FFFFFF",
                                cursor: "pointer",
                              }}
                            >
                              {i + 1}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Exam Summary */}
          <div style={{ marginBottom: 16 }}>
            <h4
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#212121",
                marginBottom: 8,
              }}
            >
              Exam Summary
            </h4>
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "#66BB6A",
                  }}
                />
                <span style={{ fontSize: 12, color: "#212121" }}>
                  Answered: {answeredCount}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "#EF5350",
                  }}
                />
                <span style={{ fontSize: 12, color: "#212121" }}>
                  Not Answered: {unansweredCount}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "#FFA726",
                  }}
                />
                <span style={{ fontSize: 12, color: "#212121" }}>
                  Marked: {markedCount}
                </span>
              </div>
              <div
                style={{ borderTop: "1px solid #E0E0E0", margin: "8px 0" }}
              />
              <div style={{ fontSize: 12, color: "#212121", marginBottom: 4 }}>
                Current Question: {currentIndex + 1}/
                {activeSectionQuestions.length}
              </div>
              <div style={{ fontSize: 12, color: "#E65100", marginBottom: 4 }}>
                Time Remaining: {formatTime(remainingSecs)}
              </div>
              <div style={{ fontSize: 12, color: "#4CAF50" }}>
                Connection: Online
              </div>
            </div>
          </div>

          {/* 3. Calculator */}
          <div style={{ marginBottom: 16 }}>
            <h4
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#212121",
                marginBottom: 8,
              }}
            >
              Calculator
            </h4>
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 10,
              }}
            >
              {/* Display */}
              <div
                style={{
                  background: "#F5F5F5",
                  borderRadius: 4,
                  padding: "8px 10px",
                  marginBottom: 8,
                  textAlign: "right",
                }}
              >
                <span
                  style={{
                    fontFamily: "Consolas, monospace",
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#212121",
                  }}
                >
                  {calculator.display}
                </span>
              </div>
              {/* Buttons: 4 columns */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 2,
                }}
              >
                {[
                  "7",
                  "8",
                  "9",
                  "÷",
                  "4",
                  "5",
                  "6",
                  "×",
                  "1",
                  "2",
                  "3",
                  "-",
                  "0",
                  ".",
                  "=",
                  "+",
                  "C",
                ].map((btn) => {
                  const isOperator = ["+", "-", "×", "÷"].includes(btn);
                  const isClear = btn === "C";
                  const isEquals = btn === "=";
                  let btnBg = "#FFFFFF";
                  let btnColor = "#212121";
                  let btnBorder = "1px solid #E0E0E0";
                  if (isOperator) {
                    btnColor = "#1565C0";
                  }
                  if (isClear) {
                    btnColor = "#D32F2F";
                  }
                  if (isEquals) {
                    btnBg = "#1565C0";
                    btnColor = "#FFFFFF";
                    btnBorder = "none";
                  }
                  const gridCol = isClear ? "span 4" : undefined;
                  return (
                    <button
                      key={btn}
                      onClick={() => calculator.press(btn)}
                      style={{
                        gridColumn: gridCol,
                        height: 30,
                        margin: 2,
                        background: btnBg,
                        color: btnColor,
                        border: btnBorder,
                        borderRadius: 4,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {btn}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. Rules & Regulations */}
          <div style={{ marginBottom: 16 }}>
            <h4
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#212121",
                marginBottom: 8,
              }}
            >
              Rules & Regulations
            </h4>
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <p style={{ fontSize: 11, color: "#757575", margin: "4px 0" }}>
                • Do not switch tabs or windows
              </p>
              <p style={{ fontSize: 11, color: "#757575", margin: "4px 0" }}>
                • Do not use external resources
              </p>
              <p style={{ fontSize: 11, color: "#757575", margin: "4px 0" }}>
                • Right-click is disabled
              </p>
              <p style={{ fontSize: 11, color: "#757575", margin: "4px 0" }}>
                • Violations are monitored and reported
              </p>
              <p style={{ fontSize: 11, color: "#757575", margin: "4px 0" }}>
                • Exam auto-submits when time expires
              </p>
            </div>
          </div>

          {/* 5. Legend */}
          <div style={{ marginBottom: 16 }}>
            <h4
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#212121",
                marginBottom: 8,
              }}
            >
              Legend
            </h4>
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #E0E0E0",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: "#1976D2",
                  }}
                />
                <span style={{ fontSize: 12, color: "#212121" }}>Current</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: "#66BB6A",
                  }}
                />
                <span style={{ fontSize: 12, color: "#212121" }}>Answered</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: "#EF5350",
                  }}
                />
                <span style={{ fontSize: 12, color: "#212121" }}>
                  Not Answered
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: "#FFA726",
                  }}
                />
                <span style={{ fontSize: 12, color: "#212121" }}>
                  Marked for Review
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Exam button - docked at bottom */}
        <div style={{ padding: 16, borderTop: "1px solid #E0E0E0" }}>
          <button
            onClick={() => {
              setSubmitStep(1);
              setShowSubmitDialog(true);
            }}
            style={{
              width: "100%",
              padding: "12px 16px",
              background: "#E53935",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#C62828";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "#E53935";
            }}
          >
            ⚠ Submit Exam
          </button>
        </div>
      </div>

      {/* ═══ ROW 2: FOOTER (left column only) - White bg, border-top ═══ */}
      <div
        style={{
          gridColumn: "1 / 2",
          background: "#FFFFFF",
          borderTop: "1px solid #E0E0E0",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        {/* Previous button - SecondaryButton style */}
        {!isFirstQuestion && (
          <button
            onClick={handlePrev}
            style={{
              padding: "10px 18px",
              background: "#FFFFFF",
              color: "#212121",
              border: "1px solid #E0E0E0",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#F5F5F5";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "#FFFFFF";
            }}
          >
            ← Previous
          </button>
        )}

        {/* Clear Answer - SecondaryButton */}
        <button
          onClick={handleClearAnswer}
          style={{
            padding: "10px 18px",
            background: "#FFFFFF",
            color: "#757575",
            border: "1px solid #E0E0E0",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.background = "#F5F5F5";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = "#FFFFFF";
          }}
        >
          Clear
        </button>

        {/* Mark for Review - SecondaryButton, orange when active */}
        <button
          onClick={handleMarkForReview}
          style={{
            padding: "10px 18px",
            background:
              currentQuestion && markedForReview.has(currentQuestion.id)
                ? "#FFF8E1"
                : "#FFFFFF",
            color:
              currentQuestion && markedForReview.has(currentQuestion.id)
                ? "#F57C00"
                : "#212121",
            border:
              currentQuestion && markedForReview.has(currentQuestion.id)
                ? "1px solid #F57C00"
                : "1px solid #E0E0E0",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {currentQuestion && markedForReview.has(currentQuestion.id)
            ? "✓ Marked"
            : "⚑ Mark for Review"}
        </button>

        {/* Next button - PrimaryButton style */}
        {!isLastQuestion && (
          <button
            onClick={handleNext}
            style={{
              padding: "10px 18px",
              background: "#1565C0",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#0D47A1";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "#1565C0";
            }}
          >
            Next →
          </button>
        )}
      </div>

      {/* ═══ SUBMIT DIALOG ═══ */}
      {showSubmitDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              width: 500,
              background: "#FFFFFF",
              borderRadius: 8,
              border: "1px solid #E0E0E0",
              padding: 0,
            }}
          >
            <div style={{ padding: 40 }}>
              {/* Step 1: First confirmation */}
              {submitStep === 1 && (
                <>
                  <h2
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "#212121",
                      textAlign: "center",
                      marginBottom: 20,
                    }}
                  >
                    Submit Exam?
                  </h2>
                  <div
                    style={{
                      background: "#F5F5F5",
                      borderRadius: 8,
                      padding: 20,
                      marginBottom: 20,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 14,
                        marginBottom: 10,
                      }}
                    >
                      <span>Total Questions</span>
                      <span style={{ fontWeight: 600 }}>{totalQuestions}</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 14,
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ color: "#66BB6A" }}>Answered</span>
                      <span style={{ fontWeight: 600, color: "#66BB6A" }}>
                        {answeredCount}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 14,
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ color: "#EF5350" }}>Not Answered</span>
                      <span style={{ fontWeight: 600, color: "#EF5350" }}>
                        {unansweredCount}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 14,
                      }}
                    >
                      <span style={{ color: "#FFA726" }}>
                        Marked for Review
                      </span>
                      <span style={{ fontWeight: 600, color: "#FFA726" }}>
                        {markedCount}
                      </span>
                    </div>
                  </div>
                  <p
                    style={{
                      fontSize: 13,
                      color: "#757575",
                      textAlign: "center",
                      marginBottom: 20,
                    }}
                  >
                    Do you want to submit your exam? You still have time
                    remaining.
                  </p>
                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      onClick={() => {
                        setShowSubmitDialog(false);
                        setSubmitStep(0);
                      }}
                      style={{
                        flex: 1,
                        height: 42,
                        fontSize: 14,
                        background: "#FFF",
                        border: "1px solid #E0E0E0",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      Go Back
                    </button>
                    <button
                      onClick={() => setSubmitStep(2)}
                      style={{
                        flex: 1,
                        height: 42,
                        fontSize: 14,
                        fontWeight: 600,
                        background: "#FF9800",
                        color: "#FFF",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      Yes, Submit
                    </button>
                  </div>
                </>
              )}

              {/* Step 2: Second confirmation */}
              {submitStep === 2 && (
                <>
                  <h2
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "#E65100",
                      textAlign: "center",
                      marginBottom: 20,
                    }}
                  >
                    ⚠️ Are you sure?
                  </h2>
                  <p
                    style={{
                      fontSize: 14,
                      color: "#212121",
                      textAlign: "center",
                      marginBottom: 10,
                    }}
                  >
                    You have{" "}
                    <strong style={{ color: "#EF5350" }}>
                      {unansweredCount}
                    </strong>{" "}
                    unanswered questions.
                  </p>
                  <p
                    style={{
                      fontSize: 13,
                      color: "#757575",
                      textAlign: "center",
                      marginBottom: 24,
                    }}
                  >
                    Once submitted, you cannot go back to change your answers.
                  </p>
                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      onClick={() => setSubmitStep(1)}
                      style={{
                        flex: 1,
                        height: 42,
                        fontSize: 14,
                        background: "#FFF",
                        border: "1px solid #E0E0E0",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      Go Back
                    </button>
                    <button
                      onClick={() => setSubmitStep(3)}
                      style={{
                        flex: 1,
                        height: 42,
                        fontSize: 14,
                        fontWeight: 600,
                        background: "#F44336",
                        color: "#FFF",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      I'm Sure, Submit
                    </button>
                  </div>
                </>
              )}

              {/* Step 3: Final confirmation */}
              {submitStep === 3 && (
                <>
                  <h2
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "#D32F2F",
                      textAlign: "center",
                      marginBottom: 20,
                    }}
                  >
                    🚨 Final Confirmation
                  </h2>
                  <p
                    style={{
                      fontSize: 14,
                      color: "#212121",
                      textAlign: "center",
                      marginBottom: 10,
                    }}
                  >
                    This is your <strong>last chance</strong>. After this, your
                    exam will be permanently submitted.
                  </p>
                  <p
                    style={{
                      fontSize: 13,
                      color: "#E53935",
                      textAlign: "center",
                      fontWeight: 600,
                      marginBottom: 24,
                    }}
                  >
                    This action CANNOT be undone.
                  </p>
                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      onClick={() => {
                        setShowSubmitDialog(false);
                        setSubmitStep(0);
                      }}
                      disabled={submitting}
                      style={{
                        flex: 1,
                        height: 42,
                        fontSize: 14,
                        background: "#FFF",
                        border: "1px solid #E0E0E0",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      style={{
                        flex: 1,
                        height: 42,
                        fontSize: 14,
                        fontWeight: 700,
                        background: "#D32F2F",
                        color: "#FFF",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        opacity: submitting ? 0.7 : 1,
                      }}
                    >
                      {submitting ? "Submitting..." : "CONFIRM SUBMIT"}
                    </button>
                  </div>
                  {submitting && (
                    <div
                      style={{
                        height: 3,
                        marginTop: 15,
                        background: "#E0E0E0",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: "60%",
                          background: "#D32F2F",
                          animation: "pulse 1s infinite",
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
