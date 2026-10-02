"use client";

import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useOthers,
  useStorage,
  useUpdateMyPresence,
} from "@liveblocks/react";
import type { DrawOp, Layer } from "@/lib/drawings";

// liveblocks room typing for chatsketch rooms
declare global {
  interface Liveblocks {
    Presence: {
      cursor: { x: number; y: number } | null;
      name: string;
      color: string;
    };
    Storage: {
      doc: string;
    };
  }
}

export type Peer = { id: number; x: number; y: number; name: string; color: string };

const PEER_COLORS = ["#f43f5e", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"];
const PEER_NAMES = ["Fox", "Owl", "Bear", "Wolf", "Hawk", "Deer"];

// syncing one drawing doc plus live cursors, string snapshots keep it simple
export default function LiveSync({
  ops,
  layers,
  applyDoc,
  boxRef,
  view,
  onPeers,
}: {
  ops: DrawOp[];
  layers: Layer[];
  applyDoc: (ops: DrawOp[], layers: Layer[]) => void;
  boxRef: React.RefObject<HTMLDivElement | null>;
  view: { s: number; cx: number; cy: number };
  onPeers: (p: Peer[]) => void;
}) {
  const updatePresence = useUpdateMyPresence();
  const others = useOthers();
  const doc = useStorage((root) => root.doc);
  const setDoc = useMutation(({ storage }, snap: string) => {
    storage.set("doc", snap);
  }, []);

  // who i am in the room, picked once after mount
  const [me, setMe] = useState({ name: "Guest", color: "#888888" });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMe({
      name: PEER_NAMES[Math.floor(Math.random() * PEER_NAMES.length)],
      color: PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)],
    });
  }, []);

  // snapshot guards so we never echo our own writes back
  const lastSent = useRef("");
  const lastApplied = useRef("");

  // pushing local canvas out
  useEffect(() => {
    const snap = JSON.stringify({ ops, layers });
    if (!snap || snap === lastApplied.current || snap === lastSent.current) return;
    lastSent.current = snap;
    setDoc(snap);
  }, [ops, layers, setDoc]);

  // pulling remote canvas in, merging appends by stroke key
  useEffect(() => {
    if (!doc || doc === lastSent.current || doc === lastApplied.current) return;
    lastApplied.current = doc;
    try {
      const parsed = JSON.parse(doc) as { ops?: DrawOp[]; layers?: Layer[] };
      if (Array.isArray(parsed.ops)) {
        applyDoc(parsed.ops, Array.isArray(parsed.layers) ? parsed.layers : []);
      }
    } catch {
      // corrupt snapshot, ignoring
    }
  }, [doc, applyDoc]);

  // broadcasting my cursor in board coords
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const w = 1000 / view.s;
      const s = Math.min(r.width, r.height) / w;
      const ox = (r.width - s * w) / 2;
      const oy = (r.height - s * w) / 2;
      updatePresence({
        cursor: {
          x: Math.round((e.clientX - r.left - ox) / s + (view.cx - w / 2)),
          y: Math.round((e.clientY - r.top - oy) / s + (view.cy - w / 2)),
        },
        name: me.name,
        color: me.color,
      });
    };
    const leave = () => updatePresence({ cursor: null });
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [boxRef, view, me, updatePresence]);

  // reporting who else is here
  useEffect(() => {
    onPeers(
      others
        .filter((o) => o.presence?.cursor)
        .map((o) => ({
          id: o.connectionId,
          x: (o.presence.cursor as { x: number; y: number }).x,
          y: (o.presence.cursor as { x: number; y: number }).y,
          name: o.presence.name || "Guest",
          color: o.presence.color || "#888",
        }))
    );
  }, [others, onPeers]);

  return null;
}
