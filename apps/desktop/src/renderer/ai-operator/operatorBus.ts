import type {
  AiOperatorCommandEvent,
  AiOperatorTranscriptEvent,
  AiToolCall,
  AiToolResult,
} from "../../shared/ai-operator/types";

type CommandListener = (event: AiOperatorCommandEvent) => void;
type TranscriptListener = (event: AiOperatorTranscriptEvent) => void;

const commandListeners = new Set<CommandListener>();
const transcriptListeners = new Set<TranscriptListener>();

export const aiOperatorBus = {
  onCommand(listener: CommandListener) {
    commandListeners.add(listener);
    return () => {
      commandListeners.delete(listener);
    };
  },

  executeTool(call: AiToolCall): Promise<AiToolResult> {
    if (commandListeners.size === 0) {
      return Promise.resolve({
        callId: call.id,
        ok: false,
        error: {
          code: "NO_PROVIDER",
          message: "No Present AI Operator tool provider is mounted.",
        },
      });
    }

    return new Promise((resolve) => {
      const [listener] = commandListeners;
      listener({ call, resolve });
    });
  },

  onTranscript(listener: TranscriptListener) {
    transcriptListeners.add(listener);
    return () => {
      transcriptListeners.delete(listener);
    };
  },

  emitTranscript(event: AiOperatorTranscriptEvent) {
    transcriptListeners.forEach((listener) => listener(event));
  },
};
