import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { RouterProvider, ToastProvider } from "./components/app-context";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </RouterProvider>
  </StrictMode>,
);
