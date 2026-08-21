// API pública del motor de entrevista.
// La UI (fases futuras) consumirá SOLO estas funciones.

export * from "./engine.ts";
export * from "./brief.ts";
export * from "./requirements.ts";
export * from "./stories.ts";
export * from "./curation.ts";
export type { BriefDocument, UserStory, UserStoryInput } from "./schema.ts";
