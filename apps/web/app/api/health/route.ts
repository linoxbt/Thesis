import { THESIS_PROGRAM_ID } from "@thesis/chain";
import { configPda, connection } from "@/lib/chain";
import { env, hasDb, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — what is live on this deployment, so the UI can say so
 * instead of failing: is the program deployed on this cluster, is it
 * initialised, is an indexer database attached.
 */
export async function GET() {
  const [program, config] = await Promise.all([
    connection.getAccountInfo(THESIS_PROGRAM_ID).catch(() => null),
    connection.getAccountInfo(configPda).catch(() => null),
  ]);
  return json(
    {
      cluster: env.cluster,
      programId: THESIS_PROGRAM_ID.toBase58(),
      programDeployed: !!program?.executable,
      configInitialized: !!config,
      indexer: hasDb(),
    },
    200,
    30,
  );
}
