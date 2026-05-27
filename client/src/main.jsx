import React from "react";
import ReactDOM from "react-dom/client";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import App from "./App.jsx";
import { LanguageProvider } from "./i18n.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/:locale/*" element={
          <LanguageProvider>
            <App />
          </LanguageProvider>
        } />
        <Route path="*" element={<Navigate to="/cn/" replace />} />
      </Routes>
    </Router>
  </React.StrictMode>
);
