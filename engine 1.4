import Ajv from "ajv";
import addFormats from "ajv-formats";

/**
 * Engine One Validator — Extreme
 * - Strict JSON Schema validation
 * - XOR envelope contract enforcement ({result} OR {error})
 * - Normalization (domain lowercasing, trimming)
 * - Read-only audit findings (risk flags)
 *
 * Endpoints:
 * - GET  /?mode=health
 * - GET  /?mode=spec
 * - POST /  { mode, payload }
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function res(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify(body),
  };
}

// XOR envelope helpers
function ok(resultArray) {
  return res(200, { result: resultArray });
}

function fail(code, status, message, errors = []) {
  return res(code, {
    error: {
      code,
      status,
      message,
      errors,
    },
  });
}

function errItem({ domain, location, locationType, message, reason }) {
  return { domain, location, locationType, message, reason };
}

/** Hardened schema for SAML config */
const SAML_CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "saml", "domains", "created_at", "updated_at"],
  properties: {
    id: { type: "string", minLength: 1 },

    saml: {
      type: "object",
      additionalProperties: false,
      required: ["id", "entity_id", "attribute_mapping", "name_id_format"],
      properties: {
        id: { type: "string", minLength: 1 },
        entity_id: { type: "string", minLength: 1 },

        // Exactly one must exist (enforced by oneOf below)
        metadata_url: { type: "string", format: "uri" },
        metadata_xml: { type: "string", minLength: 1 },

        attribute_mapping: {
          type: "object",
          additionalProperties: false,
          required: ["keys"],
          properties: {
            keys: {
              type: "object",
              minProperties: 1,
              additionalProperties: {
                type: "object",
                additionalProperties: false,
                required: ["name", "names", "array"],
                properties: {
                  name: { type: "string", minLength: 1 },
                  names: {
                    type: "array",
                    minItems: 1,
                    items: { type: "string", minLength: 1 },
                  },
                  default: {
                    oneOf: [
                      { type: "null" },
                      { type: "number" },
                      { type: "string" },
                      { type: "boolean" },
                      { type: "array", items: { type: "string" } },
                    ],
                  },
                  array: { type: "boolean" },
                },
              },
            },
          },
        },

        name_id_format: {
          type: "string",
          enum: [
            "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
            "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
            "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
          ],
        },
      },
      oneOf: [
        { required: ["metadata_url"], not: { required: ["metadata_xml"] } },
        { required: ["metadata_xml"], not: { required: ["metadata_url"] } },
      ],
    },

    domains: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "domain", "created_at", "updated_at"],
        properties: {
          id: { type: "string", minLength: 1 },
          domain: { type: "string", minLength: 1 },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
    },

    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
};

/** Envelope schema: XOR result or error */
const ENVELOPE_SCHEMA = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["result"],
      properties: {
        result: {
          type: "array",
          items: { type: "object" },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["error"],
      properties: {
        error: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              additionalProperties: false,
              required: ["code", "errors", "message", "status"],
              properties: {
                code: { type: "number" },
                status: { type: "string" },
                message: { type: "string" },
                errors: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["domain", "location", "locationType", "message", "reason"],
                    properties: {
                      domain: { type: "string" },
                      location: { type: "string" },
                      locationType: { type: "string" },
                      message: { type: "string" },
                      reason: { type: "string" },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  ],
};

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);

const validateSaml = ajv.compile(SAML_CONFIG_SCHEMA);
const validateEnvelope = ajv.compile(ENVELOPE_SCHEMA);

function ajvToErrors(errs, domain = "schema") {
  return (errs || []).map((e) =>
    errItem({
      domain,
      location: e.instancePath ? `payload${e.instancePath}` : "payload",
      locationType: "body",
      message: e.message || "validation error",
      reason: e.keyword || "validation",
    })
  );
}

function normalizeSamlConfig(payload) {
  const out = structuredClone(payload);

  if (Array.isArray(out.domains)) {
    out.domains = out.domains.map((d) => {
      const domain = typeof d.domain === "string" ? d.domain.trim().toLowerCase() : d.domain;
      return { ...d, domain };
    });
  }

  if (out.saml && typeof out.saml.metadata_url === "string") out.saml.metadata_url = out.saml.metadata_url.trim();
  if (out.saml && typeof out.saml.metadata_xml === "string") out.saml.metadata_xml = out.saml.metadata_xml.trim();

  const keys = out?.saml?.attribute_mapping?.keys;
  if (keys && typeof keys === "object") {
    for (const k of Object.keys(keys)) {
      const m = keys[k];
      if (m && Array.isArray(m.names)) {
        m.names = m.names.map((x) => (typeof x === "string" ? x.trim() : x)).filter(Boolean);
      }
      if (typeof m?.name === "string") m.name = m.name.trim();
    }
  }

  return out;
}

function auditSamlConfig(cfg) {
  const findings = [];

  if (cfg?.saml?.metadata_url) {
    try {
      const u = new URL(cfg.saml.metadata_url);
      if (u.protocol !== "https:") {
        findings.push({
          severity: "high",
          code: "METADATA_URL_NOT_HTTPS",
          message: "metadata_url should be https to avoid MITM.",
          location: "payload.saml.metadata_url",
        });
      }
    } catch {
      findings.push({
        severity: "high",
        code: "METADATA_URL_INVALID",
        message: "metadata_url is not a valid URI.",
        location: "payload.saml.metadata_url",
      });
    }
  }

  if (cfg?.saml?.entity_id && !cfg.saml.entity_id.includes(":")) {
    findings.push({
      severity: "medium",
      code: "ENTITY_ID_SUSPICIOUS",
      message: "entity_id is usually a URI; verify it matches your IdP.",
      location: "payload.saml.entity_id",
    });
  }

  for (const d of cfg.domains || []) {
    if (typeof d.domain === "string") {
      if (d.domain.includes(" ")) {
        findings.push({
          severity: "high",
          code: "DOMAIN_HAS_SPACES",
          message: "Domain contains spaces; invalid.",
          location: "payload.domains[].domain",
        });
      }
      if (d.domain.includes("http://") || d.domain.includes("https://")) {
        findings.push({
          severity: "high",
          code: "DOMAIN_LOOKS_LIKE_URL",
          message: "Domain should be a hostname, not a URL.",
          location: "payload.domains[].domain",
        });
      }
      if (d.domain.split(".").length < 2) {
        findings.push({
          severity: "medium",
          code: "DOMAIN_MISSING_TLD",
          message: "Domain missing a dot/TLD; verify.",
          location: "payload.domains[].domain",
        });
      }
    }
  }

  const keys = cfg?.saml?.attribute_mapping?.keys || {};
  const keyNames = Object.keys(keys);
  if (keyNames.length === 0) {
    findings.push({
      severity: "high",
      code: "ATTRIBUTE_MAPPING_EMPTY",
      message: "attribute_mapping.keys is empty; users may not map correctly.",
      location: "payload.saml.attribute_mapping.keys",
    });
  } else {
    const present = new Set();
    for (const k of keyNames) {
      const entry = keys[k];
      if (typeof entry?.name === "string") present.add(entry.name.toLowerCase());
      if (Array.isArray(entry?.names)) entry.names.forEach((n) => typeof n === "string" && present.add(n.toLowerCase()));
    }
    if (!present.has("email")) {
      findings.push({
        severity: "medium",
        code: "EMAIL_MAPPING_MISSING",
        message: "No obvious email attribute mapping detected; verify IdP attributes.",
        location: "payload.saml.attribute_mapping.keys",
      });
    }
  }

  return findings;
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };

  if (event.httpMethod === "GET") {
    try {
      const url = new URL(event.rawUrl);
      const mode = (url.searchParams.get("mode") || "health").toLowerCase();

      if (mode === "spec") {
        return ok([
          {
            type: "validator_spec",
            modes: ["validate_saml_config", "audit_saml_config", "validate_envelope_contract"],
            contracts: ["xor_envelope"],
          },
        ]);
      }

      return ok([
        {
          type: "health",
          ok: true,
          runtime: { node: process.version },
        },
      ]);
    } catch (e) {
      return fail(500, "INTERNAL", "health/spec failed", [
        errItem({
          domain: "runtime",
          location: "handler(GET)",
          locationType: "function",
          message: String(e?.message || e),
          reason: "exception",
        }),
      ]);
    }
  }

  if (event.httpMethod !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Use POST");

  const body = parseBody(event);
  if (!body) return fail(400, "INVALID_ARGUMENT", "Body must be valid JSON");

  const mode = String(body.mode || "").trim();

  if (mode === "validate_envelope_contract") {
    const payload = body.payload;
    const valid = validateEnvelope(payload);
    if (!valid) {
      return fail(400, "INVALID_ARGUMENT", "Envelope contract validation failed", ajvToErrors(validateEnvelope.errors, "envelope"));
    }
    return ok([{ type: "envelope_validation", valid: true }]);
  }

  if (mode !== "validate_saml_config" && mode !== "audit_saml_config") {
    return fail(400, "INVALID_ARGUMENT", "Invalid mode", [
      errItem({
        domain: "request",
        location: "body.mode",
        locationType: "body",
        message: "mode must be one of: validate_saml_config | audit_saml_config | validate_envelope_contract",
        reason: "invalid_mode",
      }),
    ]);
  }

  if (!body.payload || typeof body.payload !== "object") {
    return fail(400, "INVALID_ARGUMENT", "payload must be an object", [
      errItem({
        domain: "request",
        location: "body.payload",
        locationType: "body",
        message: "payload must be an object",
        reason: "invalid_payload",
      }),
    ]);
  }

  const normalized = normalizeSamlConfig(body.payload);

  const valid = validateSaml(normalized);
  if (!valid) {
    return fail(400, "INVALID_ARGUMENT", "SAML config schema validation failed", ajvToErrors(validateSaml.errors, "saml_config"));
  }

  if (mode === "audit_saml_config") {
    const findings = auditSamlConfig(normalized);
    return ok([
      {
        type: "saml_config_audit",
        valid: true,
        findings,
        normalized,
      },
    ]);
  }

  return ok([
    {
      type: "saml_config_validation",
      valid: true,
      normalized,
    },
  ]);
};
