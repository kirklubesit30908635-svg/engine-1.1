export async function handler(event) {
  try {
    const token = process.env.NETLIFY_AUTH_TOKEN;
    if (!token) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing NETLIFY_AUTH_TOKEN env var" }),
      };
    }

    // Example: /api/netlify/sites  ->  https://api.netlify.com/api/v1/sites
    // If you call /.netlify/functions/netlifyProxy?path=/sites it also works.
    const url = new URL(event.rawUrl);
    const path = url.searchParams.get("path") || "/sites";

    const upstream = `https://api.netlify.com/api/v1${path}`;

    const resp = await fetch(upstream, {
      headers: {
        "User-Agent": "Autokirk (ops@kirkdigitalholdings.com)",
        Authorization: `Bearer ${token}`,
      },
    });

    const text = await resp.text();

    return {
      statusCode: resp.status,
      headers: { "content-type": resp.headers.get("content-type") || "application/json" },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String(err) }),
    };
  }
}
