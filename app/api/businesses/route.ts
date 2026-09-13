import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getBusinessService } from "@/foundation";

export async function GET() {
  return NextResponse.json(await getBusinessService().list());
}

export async function POST(request: Request) {
  try {
    const business = await getBusinessService().create(await request.json());
    return NextResponse.json(business, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ issues: error.issues }, { status: 400 });
    }
    throw error;
  }
}
