export async function handler(event) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify({
      ok: true,
      engine: "Engine One",
      message: "Clarity → Execution online"
    })
  };
}
