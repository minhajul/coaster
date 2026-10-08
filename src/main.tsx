import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./game/App";
import { useGameStore } from "./game/useGameStore";

if (import.meta.env.DEV) {
  // Dev-only hook so the game state can be inspected from the console / automation.
  (window as unknown as { __game: typeof useGameStore }).__game = useGameStore;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
