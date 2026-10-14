import { env, AIRTABLE_BASE_ID, LEADS_TABLE_ID } from "./config.mjs";

const API = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${env("AIRTABLE_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Airtable ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const getLead = (id) => call("GET", `/${LEADS_TABLE_ID}/${id}`);

export const updateLead = (id, fields) =>
  call("PATCH", `/${LEADS_TABLE_ID}/${id}`, { fields, typecast: true });

// All records matching a formula (follows pagination).
export async function findRecords(table, formula, maxPages = 20) {
  const out = [];
  let offset;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ pageSize: "100" });
    if (formula) qs.set("filterByFormula", formula);
    if (offset) qs.set("offset", offset);
    const data = await call("GET", `/${table}?${qs}`);
    out.push(...data.records);
    if (!data.offset) break;
    offset = data.offset;
  }
  return out;
}

export const findLeads = (formula) => findRecords(LEADS_TABLE_ID, formula);

// Airtable formula string literal
export const q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Update up to 10 records per request: [{ id, fields }, ...]
export async function updateLeads(records) {
  for (let i = 0; i < records.length; i += 10) {
    await call("PATCH", `/${LEADS_TABLE_ID}`, { records: records.slice(i, i + 10), typecast: true });
  }
}
