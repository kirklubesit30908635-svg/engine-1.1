import React from "react";
import { Routes, Route } from "react-router-dom";
import CockpitShell from "./components/CockpitShell";
import AuthGate from "./components/AuthGate";

import Console from "./screens/Console";
import Memory from "./screens/Memory";
import Doctrine from "./screens/Doctrine";
import Diagnostics from "./screens/Diagnostics";
import Login from "./screens/Login";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <AuthGate>
            <CockpitShell />
          </AuthGate>
        }
      >
        <Route path="/" element={<Console />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/doctrine" element={<Doctrine />} />
        <Route path="/diagnostics" element={<Diagnostics />} />
        <Route path="/tools" element={<Diagnostics />} />
      </Route>
    </Routes>
  );
}
