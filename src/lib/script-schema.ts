export const scriptJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "synopsis", "playerCount", "estimatedMinutes", "roles", "phases", "clueDecks", "clues", "truth", "endings", "review"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    synopsis: { type: "string" },
    playerCount: { type: "integer", minimum: 1, maximum: 20 },
    estimatedMinutes: { type: "integer", minimum: 10 },
    roles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "publicBio", "privateBrief", "objectives"],
        properties: {
          id: { type: "string" }, name: { type: "string" }, publicBio: { type: "string" }, privateBrief: { type: "string" }, objectives: { type: "array", items: { type: "string" } }, sourcePages: { type: "array", items: { type: "string" } },
        },
      },
    },
    phases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "objective", "hostPrompt", "allowedActions", "durationMinutes"],
        properties: {
          id: { type: "string" }, name: { type: "string" }, objective: { type: "string" }, hostPrompt: { type: "string" },
          allowedActions: { type: "array", items: { type: "string", enum: ["read", "search", "discuss", "vote"] } },
          durationMinutes: { type: "integer", minimum: 1 },
        },
      },
    },
    clueDecks: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "name", "drawLimitPerPlayer"], properties: { id: { type: "string" }, name: { type: "string" }, drawLimitPerPlayer: { type: "integer", minimum: 0 } } },
    },
    clues: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "title", "content", "deckId", "availableFromPhase", "visibility", "sourceRef"], properties: { id: { type: "string" }, title: { type: "string" }, content: { type: "string" }, deckId: { type: "string" }, availableFromPhase: { type: "string" }, visibility: { type: "string", enum: ["private", "public"] }, sourceRef: { type: "string" } } },
    },
    truth: {
      type: "object", additionalProperties: false, required: ["culpritRoleId", "method", "motive", "timeline"],
      properties: { culpritRoleId: { type: "string" }, method: { type: "string" }, motive: { type: "string" }, timeline: { type: "array", items: { type: "string" } } },
    },
    endings: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "condition", "title", "text"], properties: { id: { type: "string" }, condition: { type: "string", enum: ["solved", "escaped", "framed"] }, title: { type: "string" }, text: { type: "string" } } },
    },
    review: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["path", "confidence", "note"], properties: { path: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, note: { type: "string" } } },
    },
  },
} as const;
