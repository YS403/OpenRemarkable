/** A folder or document as exposed to the browser. Shared by server and client code. */
export interface CloudItem {
  id: string;
  hash: string;
  name: string;
  kind: "folder" | "document";
  /** pdf, epub or notebook for documents; null for folders */
  fileType: "pdf" | "epub" | "notebook" | null;
  /** "" is the root folder, "trash" is the trash */
  parent: string;
  pinned: boolean;
  lastModified: string | null;
}

export const ROOT_FOLDER = "";
export const TRASH_FOLDER = "trash";
