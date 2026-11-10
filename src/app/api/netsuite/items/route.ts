import "server-only";
import { NextResponse } from "next/server";
import { readItemsResponse } from "@/lib/netsuite/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readItemsResponse();
  return NextResponse.json(result.body, { status: result.status });
}
