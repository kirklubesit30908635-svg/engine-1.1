# Engine One Validator — Extreme (Netlify Functions)

This repo deploys a Netlify Function at:

- `POST /.netlify/functions/react` (Netlify internal)
- `GET  /.netlify/functions/react?mode=health`
- `GET  /.netlify/functions/react?mode=spec`
- If you map functions to `/api/*` in your Netlify site, you can also use `/api/react`.

## Response Contract (XOR)
Every response is **either**:
- `{"result":[...]}`
- `{"error":...}`

Never both.

## Modes (POST)
Send JSON:
```json
{
  "mode": "validate_saml_config",
  "payload": { ... }
}
```

Modes:
- `validate_saml_config` — validates + normalizes SAML config (strict)
- `audit_saml_config` — validation + risk findings (read-only)
- `validate_envelope_contract` — validates the XOR envelope contract

## Quick test (replace $URL)
```bash
curl -s -X POST "$URL/.netlify/functions/react" \
  -H "content-type: application/json" \
  -d '{"mode":"validate_saml_config","payload":{"id":"x","saml":{"id":"s","entity_id":"e","metadata_url":"https://example.com/metadata.xml","attribute_mapping":{"keys":{"email":{"name":"email","names":["email"],"array":false}}},"name_id_format":"urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"},"domains":[{"id":"d","domain":"Example.COM","created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z"}],"created_at":"2025-01-01T00:00:00Z","updated_at":"2025-01-01T00:00:00Z"}}'
```

Generated: 2025-12-20
