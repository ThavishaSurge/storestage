#!/usr/bin/env node
/* eslint-env node */
/**
 * Validates every `#graphql` document in app/ against the Admin API schema.
 *
 * Schema source (first that exists):
 *   1. SHOPIFY_ADMIN_SCHEMA env var (path to an introspection JSON, optionally .gz)
 *   2. .schema/admin-2026-10.json(.gz) — committed, taken from Shopify's dev MCP package
 *
 * When bumping the API version, replace the schema file with the new version's introspection.
 * Fails on errors; warns on deprecated fields.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  buildClientSchema,
  parse,
  validate,
  TypeInfo,
  visit,
  visitWithTypeInfo,
} from "graphql";

const candidates = [process.env.SHOPIFY_ADMIN_SCHEMA, ".schema/admin-2026-10.json", ".schema/admin-2026-10.json.gz"].filter(Boolean);
const schemaPath = candidates.find((p) => fs.existsSync(p));
if (!schemaPath) {
  console.log("[validate-graphql] No schema found; skipping.");
  process.exit(0);
}
const rawSchema = fs.readFileSync(schemaPath);
const introspection = JSON.parse((schemaPath.endsWith(".gz") ? zlib.gunzipSync(rawSchema) : rawSchema).toString("utf8"));
const schema = buildClientSchema(introspection.data ?? introspection);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

const DOC = /`#graphql([\s\S]*?)`/g;
let errors = 0;
let warnings = 0;
let documents = 0;

for (const file of walk("app")) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(DOC)) {
    const text = match[1];
    if (text.includes("${")) {
      console.warn(`WARN ${file}: interpolated GraphQL document skipped`);
      warnings++;
      continue;
    }
    documents++;
    const line = source.slice(0, match.index).split("\n").length;
    let ast;
    try {
      ast = parse(text);
    } catch (e) {
      console.error(`ERROR ${file}:${line} ${e.message}`);
      errors++;
      continue;
    }
    for (const err of validate(schema, ast)) {
      console.error(`ERROR ${file}:${line} ${err.message}`);
      errors++;
    }
    const typeInfo = new TypeInfo(schema);
    visit(
      ast,
      visitWithTypeInfo(typeInfo, {
        Field() {
          const def = typeInfo.getFieldDef();
          const parent = typeInfo.getParentType();
          if (def?.deprecationReason) {
            console.warn(`WARN ${file}:${line} ${parent}.${def.name} is deprecated: ${def.deprecationReason}`);
            warnings++;
          }
        },
        Argument() {
          const arg = typeInfo.getArgument();
          if (arg?.deprecationReason) {
            console.warn(`WARN ${file}:${line} argument ${arg.name} is deprecated: ${arg.deprecationReason}`);
            warnings++;
          }
        },
      }),
    );
  }
}

console.log(`[validate-graphql] ${documents} documents, ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
