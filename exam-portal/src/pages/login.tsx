import { queryClient } from "@/main";
import {
    candidateService,
    generateDeviceFingerprint,
} from "@/services/candidate";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function CandidateLogin() {
  const navigate = useNavigate();
  const [admitCardNumber, setAdmitCardNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status] = useState("Ready to sign in");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admitCardNumber || !dateOfBirth) return;
    setLoading(true);
    setError("");
    try {
      const fingerprint = generateDeviceFingerprint();
      localStorage.setItem("candidateDeviceFp", fingerprint);
      const res: any = await candidateService.login(
        admitCardNumber,
        dateOfBirth,
        fingerprint,
      );
      const tokenData = res.data ?? res;
      // Clear any stale attempt state from a previous candidate's session
      // on this browser, so the new candidate doesn't inherit old exam data.
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("exam_attempt_")) {
          localStorage.removeItem(key);
        }
      }
      // Clear ALL React Query cache so the new candidate doesn't see the
      // previous candidate's cached exam metadata, questions, or exam list.
      queryClient.clear();
      localStorage.setItem("candidateAccessToken", tokenData.accessToken);
      localStorage.setItem("candidateRefreshToken", tokenData.refreshToken);
      if (tokenData.user) {
        localStorage.setItem("candidateUser", JSON.stringify(tokenData.user));
      }
      toast.success(`Welcome, ${tokenData.user?.fullName ?? "Candidate"}`);
      navigate("/exams");
    } catch (err: any) {
      const errData = err.response?.data?.error;
      const msg =
        typeof errData === "string"
          ? errData
          : (errData?.message ?? "Login failed");
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

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
      <div
        style={{
          width: 420,
          background: "#FFFFFF",
          borderRadius: 12,
          padding: "36px 40px",
          border: "1px solid #E0E0E0",
          boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <div
            style={{
              display: "inline-flex",
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "linear-gradient(135deg, #0D47A1, #1565C0, #1E88E5)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 28, color: "#FFFFFF", fontWeight: 700 }}>
              ✓
            </span>
          </div>
        </div>
        <h1
          style={{
            textAlign: "center",
            fontSize: 26,
            fontWeight: 700,
            color: "#212121",
            margin: 0,
          }}
        >
          CBT Exam
        </h1>
        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "#757575",
            marginTop: 6,
            marginBottom: 28,
          }}
        >
          Sign in to access your examination
        </p>

        {/* Status */}
        <div
          style={{
            background: "#E3F2FD",
            borderRadius: 6,
            padding: "8px 12px",
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 12, color: "#1565C0" }}>{status}</span>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#212121",
                marginBottom: 6,
              }}
            >
              Admit Card Number
            </label>
            <input
              type="text"
              value={admitCardNumber}
              onChange={(e) => setAdmitCardNumber(e.target.value)}
              placeholder="e.g. ADM-001"
              required
              style={{
                width: "100%",
                fontSize: 14,
                padding: "10px 12px",
                border: "1px solid #E0E0E0",
                borderRadius: 6,
                outline: "none",
                background: "#FFFFFF",
                boxSizing: "border-box",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#1565C0";
                e.target.style.borderWidth = "2px";
                e.target.style.padding = "9px 11px";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#E0E0E0";
                e.target.style.borderWidth = "1px";
                e.target.style.padding = "10px 12px";
              }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#212121",
                marginBottom: 6,
              }}
            >
              Date of Birth (DDMMYYYY)
            </label>
            <input
              type="text"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              placeholder="e.g. 01012000"
              maxLength={8}
              pattern="\d{8}"
              required
              style={{
                width: "100%",
                fontSize: 14,
                padding: "10px 12px",
                border: "1px solid #E0E0E0",
                borderRadius: 6,
                outline: "none",
                background: "#FFFFFF",
                boxSizing: "border-box",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#1565C0";
                e.target.style.borderWidth = "2px";
                e.target.style.padding = "9px 11px";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#E0E0E0";
                e.target.style.borderWidth = "1px";
                e.target.style.padding = "10px 12px";
              }}
            />
          </div>

          {error && (
            <div
              style={{
                background: "#FDE7E9",
                borderRadius: 4,
                padding: "8px 10px",
                marginTop: 8,
              }}
            >
              <span style={{ fontSize: 12, color: "#A4262C" }}>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: 42,
              marginTop: 20,
              fontSize: 15,
              fontWeight: 600,
              color: "#FFFFFF",
              background: "#1565C0",
              border: "none",
              borderRadius: 6,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
              boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
            }}
            onMouseEnter={(e) => {
              if (!loading)
                (e.target as HTMLElement).style.background = "#0D47A1";
            }}
            onMouseLeave={(e) => {
              if (!loading)
                (e.target as HTMLElement).style.background = "#1565C0";
            }}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? "Signing in..." : "Sign In"}
          </button>

          {loading && (
            <div
              style={{
                height: 2,
                marginTop: 12,
                background: "#E3F2FD",
                borderRadius: 1,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: "40%",
                  background: "#1565C0",
                  animation: "loadingSlide 1.5s infinite ease-in-out",
                }}
              />
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
