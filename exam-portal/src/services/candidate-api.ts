import axios from "axios";

const candidateApi = axios.create({
  baseURL: "/api/v1",
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

candidateApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("candidateAccessToken");
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const fp = localStorage.getItem("candidateDeviceFp");
  if (fp && config.headers) {
    config.headers["X-Device-FP"] = fp;
  }
  return config;
});

candidateApi.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("candidateAccessToken");
      localStorage.removeItem("candidateRefreshToken");
      localStorage.removeItem("candidateUser");
      // Clear all attempt state so the next candidate starts clean
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("exam_attempt_")) {
          localStorage.removeItem(key);
        }
      }
      if (!window.location.pathname.endsWith("/examportal/")) {
        window.location.href = "/examportal/";
      }
    }
    return Promise.reject(error);
  },
);

export default candidateApi;
