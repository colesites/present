import type { AiModelToolDefinition } from "../../shared/ai-operator/types";
// The definitions are JSON so the Tauri build serves the same file
// (`src-tauri/src/commands/ai_operator.rs` includes it at compile time) rather
// than a copy that could drift.
import presentToolDefinitions from "../../shared/ai-operator/present-tools.json";

export const presentAiTools = presentToolDefinitions as AiModelToolDefinition[];

export const getPresentAiTools = (): AiModelToolDefinition[] => presentAiTools;
