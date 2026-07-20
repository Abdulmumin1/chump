import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  AutocompleteProvider,
  Component,
  TUI,
} from "@earendil-works/pi-tui";

export type ChumpTuiSlot =
  | "header"
  | "beforeInput"
  | "afterInput"
  | "footer";

export type ChumpTuiKeyHandler = (data: string) => boolean | void;
export type ChumpTuiOutputTransform = (value: string) => string;

export type ChumpTuiTheme = {
  accent: (value: string) => string;
  muted: (value: string) => string;
  error: (value: string) => string;
};

export type ChumpTuiExtensionApi = {
  readonly tui: TUI;
  readonly theme: ChumpTuiTheme;
  addComponent: (slot: ChumpTuiSlot, component: Component) => () => void;
  addKeyHandler: (handler: ChumpTuiKeyHandler) => () => void;
  addAutocompleteProvider: (provider: AutocompleteProvider) => () => void;
  addOutputTransform: (transform: ChumpTuiOutputTransform) => () => void;
  requestRender: () => void;
};

export type ChumpTuiExtensionCleanup = () => void | Promise<void>;

export type ChumpTuiExtension = (
  api: ChumpTuiExtensionApi,
) =>
  | void
  | ChumpTuiExtensionCleanup
  | Promise<void | ChumpTuiExtensionCleanup>;

type RegisteredExtension = {
  id: string;
  extension: ChumpTuiExtension;
};

const registeredExtensions = new Map<string, ChumpTuiExtension>();

/**
 * Register an in-process TUI extension before the interactive client starts.
 * The returned function unregisters it for future TUI instances.
 */
export function registerTuiExtension(
  id: string,
  extension: ChumpTuiExtension,
): () => void {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error("TUI extension id must not be empty");
  }
  if (registeredExtensions.has(normalizedId)) {
    throw new Error(`TUI extension already registered: ${normalizedId}`);
  }
  registeredExtensions.set(normalizedId, extension);
  return () => {
    if (registeredExtensions.get(normalizedId) === extension) {
      registeredExtensions.delete(normalizedId);
    }
  };
}

export async function resolveTuiExtensions(
  cwd = process.cwd(),
): Promise<RegisteredExtension[]> {
  const extensions: RegisteredExtension[] = [...registeredExtensions].map(
    ([id, extension]) => ({ id, extension }),
  );
  const configuredPaths = (process.env.CHUMP_TUI_EXTENSIONS ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  for (const configuredPath of configuredPaths) {
    const absolutePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(cwd, configuredPath);
    const module = await import(pathToFileURL(absolutePath).href) as {
      default?: unknown;
      extension?: unknown;
    };
    const extension = module.default ?? module.extension;
    if (typeof extension !== "function") {
      throw new Error(
        `TUI extension must export a default function: ${absolutePath}`,
      );
    }
    extensions.push({
      id: absolutePath,
      extension: extension as ChumpTuiExtension,
    });
  }

  return extensions;
}
