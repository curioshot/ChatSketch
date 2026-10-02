"use client";

import { useEffect, useState } from "react";
import Logo from "./Logo";

// opening splash, once per visit, click to skip
export default function Splash() {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("chatsketch-splash")) return;
    sessionStorage.setItem("chatsketch-splash", "1");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(true);
    const out = window.setTimeout(() => setLeaving(true), 1600);
    const gone = window.setTimeout(() => setShow(false), 2000);
    return () => {
      window.clearTimeout(out);
      window.clearTimeout(gone);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      onClick={() => setShow(false)}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white transition-opacity duration-500 dark:bg-neutral-950 ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      <Logo size={96} animated />
      <h1 className="chatsketch-rise text-3xl font-bold tracking-tight" style={{ animationDelay: "0.4s" }}>
        ChatSketch
      </h1>
      <p className="chatsketch-rise text-sm text-gray-500 dark:text-gray-400" style={{ animationDelay: "0.7s" }}>
        Chat it. Sketch it.
      </p>
    </div>
  );
}
