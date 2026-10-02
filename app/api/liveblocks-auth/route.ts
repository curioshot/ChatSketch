import { Liveblocks } from "@liveblocks/node";
import { NextResponse } from "next/server";

// room tokens for live sharing, open rooms keyed by drawing id
export async function POST(req: Request) {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ error: "liveblocks not configured" }, { status: 500 });
  }
  const body = await req.json().catch(() => ({}));
  const room = String(body.room || "lobby").replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 80) || "lobby";
  try {
    const liveblocks = new Liveblocks({ secret });
    const session = liveblocks.prepareSession(`guest-${Math.random().toString(36).slice(2, 8)}`, {
      userInfo: { name: "Guest" },
    });
    session.allow(room, session.FULL_ACCESS);
    const { body: tokenBody, status } = await session.authorize();
    return new Response(tokenBody, { status });
  } catch {
    return NextResponse.json({ error: "could not start live session" }, { status: 500 });
  }
}
