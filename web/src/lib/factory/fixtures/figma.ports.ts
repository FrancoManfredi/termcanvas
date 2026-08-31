// figma.ports — composition root de las colecciones Figma.
// Cada port envuelve los MOCK_* (única fuente de datos semilla) detrás de CollectionPort,
// de modo que los componentes nunca importan MOCK_* directamente y la fuente es intercambiable.

import { DEFAULT_AGENTS, MOCK_RUNS, MOCK_AUTOMATIONS, MOCK_SCORERS, MOCK_WORK_ITEMS } from "./figma.fixtures";
import type { Agent, Run, Automation, Scorer, WorkItem } from "./figma.fixtures";
import { createFixtureCollectionPort, type CollectionPort } from "../ports/collection.port";

export const agentsPort: CollectionPort<Agent> = createFixtureCollectionPort("agents", DEFAULT_AGENTS as unknown as readonly Agent[]);
export const runsPort: CollectionPort<Run> = createFixtureCollectionPort("runs", MOCK_RUNS as unknown as readonly Run[]);
export const automationsPort: CollectionPort<Automation> = createFixtureCollectionPort("automations", MOCK_AUTOMATIONS as unknown as readonly Automation[]);
export const scorersPort: CollectionPort<Scorer> = createFixtureCollectionPort("scorers", MOCK_SCORERS as unknown as readonly Scorer[]);
export const workItemsPort: CollectionPort<WorkItem> = createFixtureCollectionPort("work-items", MOCK_WORK_ITEMS as unknown as readonly WorkItem[]);
