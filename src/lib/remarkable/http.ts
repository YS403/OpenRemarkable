import "server-only";

import { AuthError, RegisterError, ResponseError, ValidationError } from "rmapi-js";

import { NotConnectedError } from "@/lib/session/session";
import { CalendarLinkError } from "@/lib/calendar/ics/fetch";
import { EncryptedPdfError } from "@/lib/rm";

import { DocumentNotFoundError, UnsupportedDocumentError } from "./documents";

/** Map an error from the reMarkable layer to a JSON response. */
export function errorResponse(error: unknown): Response {
  if (error instanceof NotConnectedError) {
    return Response.json({ error: "not_connected", message: error.message }, { status: 401 });
  }
  if (error instanceof DocumentNotFoundError) {
    return Response.json({ error: "not_found", message: error.message }, { status: 404 });
  }
  if (error instanceof CalendarLinkError) {
    return Response.json({ error: "calendar_link", message: error.message }, { status: 422 });
  }
  if (error instanceof EncryptedPdfError) {
    return Response.json({ error: "encrypted_pdf", message: error.message }, { status: 422 });
  }
  if (error instanceof UnsupportedDocumentError) {
    return Response.json({ error: "unsupported_document", message: error.message }, { status: 415 });
  }
  if (error instanceof RegisterError) {
    return Response.json(
      { error: "register_failed", message: "reMarkable rejected the code. Codes expire quickly; get a new one and try again." },
      { status: 400 },
    );
  }
  if (error instanceof AuthError) {
    return Response.json(
      { error: "auth_failed", message: "reMarkable refused the saved device token. Disconnect and connect again." },
      { status: 401 },
    );
  }
  if (error instanceof ResponseError) {
    return Response.json(
      { error: "upstream_error", message: `reMarkable cloud returned ${error.status} ${error.statusText}.` },
      { status: 502 },
    );
  }
  if (error instanceof ValidationError) {
    return Response.json(
      { error: "unexpected_format", message: `reMarkable returned data in an unexpected format (${error.field}).` },
      { status: 502 },
    );
  }
  console.error(error);
  return Response.json({ error: "internal_error", message: "Something went wrong." }, { status: 500 });
}
