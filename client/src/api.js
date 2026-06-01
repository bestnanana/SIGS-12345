import axios from "axios";

const apiBase = import.meta.env.VITE_API_BASE || "/api";
export const AUTH_EXPIRED_EVENT = "auth-expired";

export const api = axios.create({
  baseURL: apiBase
});

export const serverOrigin = "";

export function getToken() {
  return sessionStorage.getItem("token") || localStorage.getItem("token");
}

export function setToken(token, authSource) {
  if (authSource === "native") {
    sessionStorage.setItem("token", token);
    sessionStorage.setItem("authSource", "native");
  } else {
    localStorage.setItem("token", token);
    localStorage.setItem("authSource", "sso");
  }
}

export function getAuthSource() {
  if (sessionStorage.getItem("token") && sessionStorage.getItem("authSource") === "native") {
    return "native";
  }
  if (localStorage.getItem("token")) {
    return "sso";
  }
  return null;
}

export function clearAuthStorage() {
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("authSource");
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("viewRole");
  localStorage.removeItem("authSource");
}

function notifyAuthExpired(message) {
  clearAuthStorage();
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, {
    detail: { message: message || "登录已失效，请重新登录" }
  }));
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    console.warn("[api] request without token", { url: config.url, method: config.method });
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || "";
    const skipAuthExpiredHandler = error.config?.skipAuthExpiredHandler || url.includes("/auth/login");
    if (status === 401) {
      const token = getToken();
      console.warn("[api] 401 response", {
        url,
        code: error.response?.data?.code,
        message: error.response?.data?.message,
        has_token: Boolean(token),
        token_prefix: token ? token.slice(0, 30) : null,
        skipHandler: skipAuthExpiredHandler
      });
      if (!skipAuthExpiredHandler) {
        notifyAuthExpired(error.response?.data?.message);
      }
    }
    return Promise.reject(error);
  }
);

export const uploadConfig = {
  headers: {
    "Content-Type": "multipart/form-data"
  }
};
