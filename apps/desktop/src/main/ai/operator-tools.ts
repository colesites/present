import type { AiModelToolDefinition } from "../../shared/ai-operator/types";

export const presentAiTools: AiModelToolDefinition[] = [
  {
    name: "open_song",
    namespace: "present",
    description: "Open a song or lyric item by natural title.",
    inputSchema: {
      type: "object",
      properties: {
        song: { type: "string" },
        section: { type: "string" },
      },
      required: ["song"],
      additionalProperties: false,
    },
  },
  {
    name: "search_song",
    namespace: "present",
    description: "Search songs by title or lyrics.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "queue_song",
    namespace: "present",
    description: "Add a song to the selected service plan.",
    inputSchema: {
      type: "object",
      properties: { song: { type: "string" } },
      required: ["song"],
      additionalProperties: false,
    },
  },
  {
    name: "favorite_song",
    namespace: "present",
    description: "Mark a song as a favorite.",
    inputSchema: {
      type: "object",
      properties: { song: { type: "string" } },
      required: ["song"],
      additionalProperties: false,
    },
  },
  {
    name: "next_slide",
    namespace: "present",
    description: "Advance the active presentation to the next slide.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "previous_slide",
    namespace: "present",
    description: "Move the active presentation to the previous slide.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "go_to_slide",
    namespace: "present",
    description: "Jump to a slide by one-based slide number.",
    inputSchema: {
      type: "object",
      properties: { slide: { type: "number" } },
      required: ["slide"],
      additionalProperties: false,
    },
  },
  {
    name: "start_presentation",
    namespace: "present",
    description: "Start presenting the current deck from the first slide.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "stop_presentation",
    namespace: "present",
    description: "Stop showing presentation text.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_bible_verse",
    namespace: "present",
    description: "Open a Bible reference such as John 3:16.",
    inputSchema: {
      type: "object",
      properties: {
        reference: { type: "string" },
        book: { type: "string" },
        chapter: { type: "number" },
        verse: { type: "number" },
        translation: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_bible",
    namespace: "present",
    description: "Search Bible text or references.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "change_translation",
    namespace: "present",
    description: "Change the preferred Bible translation for future scripture commands.",
    inputSchema: {
      type: "object",
      properties: { translation: { type: "string" } },
      required: ["translation"],
      additionalProperties: false,
    },
  },
  {
    name: "play_video",
    namespace: "present",
    description: "Select and play a video media asset.",
    inputSchema: {
      type: "object",
      properties: { media: { type: "string" } },
      required: ["media"],
      additionalProperties: false,
    },
  },
  {
    name: "stop_video",
    namespace: "present",
    description: "Pause the current video.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "change_background",
    namespace: "present",
    description: "Change the active background image or video.",
    inputSchema: {
      type: "object",
      properties: { background: { type: "string" } },
      required: ["background"],
      additionalProperties: false,
    },
  },
  {
    name: "play_audio",
    namespace: "present",
    description: "Play an audio item when an audio provider is available.",
    inputSchema: {
      type: "object",
      properties: { audio: { type: "string" } },
      required: ["audio"],
      additionalProperties: false,
    },
  },
  {
    name: "start_countdown",
    namespace: "present",
    description: "Start a countdown timer, optionally with a duration in seconds.",
    inputSchema: {
      type: "object",
      properties: {
        seconds: { type: "number" },
        label: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "stop_countdown",
    namespace: "present",
    description: "Stop all countdown timers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "reset_countdown",
    namespace: "present",
    description: "Reset the active countdown timer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "start_stream",
    namespace: "present",
    description: "Start livestreaming through the configured stream provider.",
    dangerous: true,
    requiresConfirmation: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "stop_stream",
    namespace: "present",
    description: "Stop livestreaming through the configured stream provider.",
    dangerous: true,
    requiresConfirmation: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "switch_scene",
    namespace: "present",
    description: "Switch the configured livestream scene.",
    inputSchema: {
      type: "object",
      properties: { scene: { type: "string" } },
      required: ["scene"],
      additionalProperties: false,
    },
  },
  {
    name: "open_library",
    namespace: "present",
    description: "Navigate to the library panel.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_notes",
    namespace: "present",
    description: "Navigate to notes or shows.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_schedule",
    namespace: "present",
    description: "Navigate to the service schedule.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_settings",
    namespace: "present",
    description: "Open Present settings.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export const getPresentAiTools = (): AiModelToolDefinition[] => presentAiTools;
