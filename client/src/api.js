import axios from "axios";

const apiBase = import.meta.env.VITE_API_BASE || "/api";
export const AUTH_EXPIRED_EVENT = "auth-expired";

export const api = axios.create({
  baseURL: apiBase
});

export const serverOrigin = "";

export function clearAuthStorage() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("viewRole");
}

function notifyAuthExpired(message) {
  clearAuthStorage();
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, {
    detail: { message: message || "登录已失效，请重新登录" }
  }));
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || "";
    const skipAuthExpiredHandler = error.config?.skipAuthExpiredHandler || url.includes("/auth/login");
    if (status === 401 && !skipAuthExpiredHandler) {
      notifyAuthExpired(error.response?.data?.message);
    }
    return Promise.reject(error);
  }
);

export const uploadConfig = {
  headers: {
    "Content-Type": "multipart/form-data"
  }
};
