const DOCUMENT_ROUTE = /^\/d\/([^/]+)\/?$/;

export function parseDocumentRoute(pathname: string): string | null {
  const m = DOCUMENT_ROUTE.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

export function documentRoute(id: string | null): string {
  return id ? `/d/${encodeURIComponent(id)}` : "/";
}
