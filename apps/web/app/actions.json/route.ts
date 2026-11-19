import { ACTION_HEADERS } from "@/lib/blink";

export const dynamic = "force-static";

/**
 * /actions.json: maps trade links to their blink, so sharing
 * https://<site>/t/<pda> lets blink-aware clients render Back / Challenge.
 */
export const GET = () =>
  new Response(
    JSON.stringify({
      rules: [
        { pathPattern: "/t/*", apiPath: "/api/actions/thesis/*" },
        { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
      ],
    }),
    { headers: ACTION_HEADERS },
  );

export const OPTIONS = () => new Response(null, { headers: ACTION_HEADERS });
