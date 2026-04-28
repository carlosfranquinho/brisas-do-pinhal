const ALLOWED_ORIGIN = "https://brisas.pinhaldorei.net";
const WU_BASE = "https://api.weather.com/v2/pws/observations/current";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204, request);
    }

    const origin = request.headers.get("Origin") || "";
    if (origin !== ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!env.WU_API_KEY) {
      return corsResponse("Worker mal configurado: WU_API_KEY em falta", 500, request);
    }

    const url =
      `${WU_BASE}?stationId=${env.WU_STATION}&format=json&units=m` +
      `&apiKey=${env.WU_API_KEY}&numericPrecision=decimal`;

    let res;
    try {
      res = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
    } catch (e) {
      return corsResponse("Erro a contactar WU: " + e.message, 502, request);
    }

    if (!res.ok) {
      return corsResponse("WU devolveu " + res.status, 502, request);
    }

    const body = await res.text();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...cors(request),
      },
    });
  },
};

function cors(request) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function corsResponse(body, status, request) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain", ...cors(request) },
  });
}
