import { createRoot } from "react-dom/client";
import { SecureContextGate } from "./SecureContextGate";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<SecureContextGate />);
