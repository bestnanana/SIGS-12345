import axios from "axios";

const apiBase = import.meta.env.VITE_API_BASE || "/api";

export const api = axios.create({
  baseURL: apiBase
});

export const serverOrigin = "";

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const uploadConfig = {
  headers: {
    "Content-Type": "multipart/form-data"
  }
};
