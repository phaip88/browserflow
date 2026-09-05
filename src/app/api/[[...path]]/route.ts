import { dispatch } from "@/server/http";
import "@/server/routes-core";
import "@/server/routes-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = (req: Request) => dispatch(req);
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
