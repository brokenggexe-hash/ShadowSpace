import { firebaseConfig } from '../config/firebase.ts';

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

export function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((v) => toFirestoreValue(v)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val: FirestoreValue): unknown {
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export function fromFirestoreDoc<T = Record<string, unknown>>(doc: {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}): (T & { _docId: string }) | null {
  if (!doc || !doc.fields) return null;
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  const parts = (doc.name || '').split('/');
  obj._docId = parts[parts.length - 1] || '';
  return obj as T & { _docId: string };
}

export async function fsGetDoc<T = Record<string, unknown>>(
  docPath: string,
  idToken: string
): Promise<(T & { _docId: string }) | null> {
  const res = await fetch(`${BASE_URL}/${docPath}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore GET ${docPath} failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return fromFirestoreDoc<T>(data);
}

export async function fsCommitWrite(
  docPath: string,
  fieldsData: Record<string, unknown>,
  serverTimestampFields: string[],
  idToken: string,
  updateMaskFields?: string[]
): Promise<void> {
  const fullName = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${docPath}`;
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(fieldsData)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }

  const write: Record<string, unknown> = {
    update: {
      name: fullName,
      fields,
    },
    updateTransforms: serverTimestampFields.map((fieldPath) => ({
      fieldPath,
      setToServerValue: 'REQUEST_TIME',
    })),
  };

  if (updateMaskFields && updateMaskFields.length > 0) {
    write.updateMask = { fieldPaths: updateMaskFields };
  }

  const res = await fetch(`${BASE_URL}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes: [write] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore COMMIT ${docPath} failed (${res.status}): ${text}`);
  }
}

export interface BatchWriteSpec {
  docPath: string;
  fieldsData: Record<string, unknown>;
  serverTimestampFields?: string[];
  updateMaskFields?: string[];
}

export async function fsBatchCommit(
  specs: BatchWriteSpec[],
  idToken: string
): Promise<void> {
  if (specs.length === 0) return;
  const writes = specs.map((spec) => {
    const fullName = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${spec.docPath}`;
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(spec.fieldsData)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    const write: Record<string, unknown> = {
      update: {
        name: fullName,
        fields,
      },
      updateTransforms: (spec.serverTimestampFields || []).map((fieldPath) => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      })),
    };
    if (spec.updateMaskFields && spec.updateMaskFields.length > 0) {
      write.updateMask = { fieldPaths: spec.updateMaskFields };
    }
    return write;
  });

  const res = await fetch(`${BASE_URL}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore BATCH COMMIT failed (${res.status}): ${text}`);
  }
}

export async function fsRunQuery<T = Record<string, unknown>>(
  structuredQuery: Record<string, unknown>,
  idToken: string
): Promise<Array<T & { _docId: string }>> {
  const res = await fetch(`${BASE_URL}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore runQuery failed (${res.status}): ${text}`);
  }
  const rows = (await res.json()) as Array<{ document?: { name?: string; fields?: Record<string, FirestoreValue> } }>;
  const items: Array<T & { _docId: string }> = [];
  for (const row of rows) {
    if (row.document) {
      const parsed = fromFirestoreDoc<T>(row.document);
      if (parsed) items.push(parsed);
    }
  }
  return items;
}

export async function fsDeleteDoc(docPath: string, idToken: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/${docPath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Firestore DELETE ${docPath} failed (${res.status}): ${text}`);
  }
}
