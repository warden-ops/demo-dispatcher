import "server-only";
import { NextResponse } from "next/server";
import { writeDispatchResponse } from "@/lib/netsuite/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requête JSON invalide." },
      { status: 400 },
    );
  }
  const result = await writeDispatchResponse(payload);
  return NextResponse.json(result.body, { status: result.status });
}
