---
name: xstate-architecture
description: Universal skill for building Next.js applications with XState v5 state management. Defines strict separation of concerns, patterns, and conventions.
---

# XState Frontend Architecture

> Universal skill for building Next.js applications with XState v5 state management. Defines the strict separation of concerns, patterns, and conventions that all frontend repositories must follow.

## Core Architecture — 4-Layer Separation

```
┌─────────────────────────────────────────────────────┐
│  UI COMPONENTS  — Pure presentation, no logic        │
│  (Props/hooks only. Never import machines directly)  │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│  CUSTOM HOOKS  — Bridge layer                        │
│  (Expose { state, data, actions } to components)     │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│  STATE MACHINES  — All business logic                │
│  (Transitions, side effects, validation, actors)     │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│  LIBRARY MODULES  — Utilities, API clients, types    │
│  (Reusable, pure, no UI or state awareness)          │
└─────────────────────────────────────────────────────┘
```

**This is a hard constraint.** Components never talk to machines directly. Hooks never render UI. Machines never know about React. Breaking this separation is the #1 source of maintenance debt.

## Data Flow

```
User clicks button
  → Component calls hook action (e.g., actions.submit.create(data))
    → Hook dispatches event to actor (actorRef.send({ type: "user.create", data }))
      → Machine processes event, updates context, invokes services
        → Hook observes state change via useSelector
          → Component re-renders with new data
```

## Folder Structure

```
src/
├── app/                    # Next.js App Router pages
├── machines/               # XState state machines (one per domain)
│   ├── appMachine.ts       # Root orchestrator — spawns all domain machines
│   ├── featureMachine.ts   # Domain-specific machine
│   └── index.ts            # Barrel exports
├── context/                # React Context — root actor provider
│   └── appContext.tsx       # createActorContext setup
├── hooks/                  # Custom hooks — bridge layer
│   ├── useAppContext.ts    # Root state + settings
│   ├── useFeatureContext.ts # Domain-specific hook
│   └── useToast.ts         # Notification subscription
├── types/                  # TypeScript types + Zod schemas
│   ├── index.ts            # Barrel exports
│   └── featureTypes.ts     # Domain types with Zod validation
├── components/
│   ├── ui/                 # shadcn/ui primitives (never edit directly)
│   ├── shared/             # Cross-feature reusable components
│   ├── layout/             # Navigation, sidebar, top bar
│   └── {feature}/          # Feature-specific components
└── lib/                    # Utilities (API client, case conversion, etc.)
```

## Machine Definition Pattern

Every machine uses XState v5's `setup()` pattern with explicit types:

```typescript
import { setup, assign, sendTo, sendParent, emit, fromPromise } from "xstate";
import { z } from "zod";

// 1. Zod schema for context validation
const ContextSchema = z.object({
  items: z.array(ItemSchema),
  selectedId: z.string().nullable(),
  childRef: z.any().optional(),
});
type Context = z.infer<typeof ContextSchema>;

// 2. Discriminated union for events (namespaced by source)
type Events =
  | { type: "user.select"; id: string }
  | { type: "user.create"; data: CreateInput }
  | { type: "user.delete"; id: string }
  | { type: "app.updateSettings"; settings: Settings }
  | { type: "child.completed"; result: Item[] }
  | { type: "sys.activate" }
  | { type: "sys.deactivate" };

// 3. Setup with types, actors, actions, guards
export const featureMachine = setup({
  types: {
    context: {} as Context,
    events: {} as Events,
    input: {} as { initialItems?: Item[] },
    emitted: {} as { type: "notification"; data: { type: "success" | "error"; message: string } },
  },
  actors: {
    fetcher: fromPromise(async ({ input }: { input: { page: number } }) => {
      const response = await apiCall("GET", `/items?page=${input.page}`);
      return response;
    }),
  },
  actions: {
    notifySuccess: emit({ type: "notification", data: { type: "success", message: "Done" } }),
    notifyError: emit(({ event }) => ({
      type: "notification",
      data: { type: "error", message: `Failed: ${event.type}` },
    })),
  },
  guards: {
    hasItems: ({ context }) => context.items.length > 0,
    hasSelection: ({ context }) => context.selectedId !== null,
  },
}).createMachine({
  id: "feature",
  context: ({ input }) => ContextSchema.parse({
    items: input?.initialItems ?? [],
    selectedId: null,
  }),
  initial: "idle",
  states: {
    idle: {
      on: {
        "sys.activate": "loading",
        "user.select": { actions: assign({ selectedId: ({ event }) => event.id }) },
      },
    },
    loading: {
      invoke: {
        src: "fetcher",
        input: ({ context }) => ({ page: 1 }),
        onDone: {
          target: "ready",
          actions: [assign({ items: ({ event }) => event.output }), "notifySuccess"],
        },
        onError: { target: "error", actions: "notifyError" },
      },
      on: {
        "sys.deactivate": "inactive",  // real transition, fetch auto-canceled
      },
    },
    ready: {
      on: {
        "user.select": { actions: assign({ selectedId: ({ event }) => event.id }) },
        "sys.deactivate": "inactive",
      },
    },
    inactive: {
      on: {
        "sys.activate": [
          { guard: "hasItems", target: "ready" },
          { target: "loading" },
        ],
      },
    },
  },
});
```

### Machine Rules

1. **One machine per domain.** Don't put agent logic and session logic in the same machine.
2. **Validate context with Zod** at initialization. Use `ContextSchema.parse()` in the context factory.
3. **Always provide `onError`** for every `invoke`. Silent failures are bugs.
4. **Use `emit()` for notifications.** Never call `toast()` from a machine — emit an event, let the hook subscribe.
5. **Use guards for conditions.** Don't put `if` statements in action logic — use declarative guards.
6. **All guards must be named.** Define guards in `setup({ guards: { ... } })` and reference by string. No inline anonymous guard functions — they're unreadable in the inspector and in code review.
7. **Descriptions are the documentation.** XState v5 supports `description?: string` on machine definitions, state nodes, transitions, `onDone`/`onError`, `onSnapshot`, `always`, and `after`. The Stately Inspector renders these — they are the primary way to understand a machine without reading code. No code comments in machine files.

**Machine description = context documentation as bullet points.** The machine-level `description` documents every context field using `- fieldName (type): description` format. Type goes in parentheses right after the name — this is critical because the inspector only shows `object` or `array` for complex types. Use specific types: `(Session[])`, `(Record<string, terminalMachine actor>)`, `(Socket | null)`, not generic `(Record)` or `(object)`. Use `.join("\n")` array format.

**Every state must have a description.** Short summary first, then details about invoked actors, entry/exit actions, and substates. Use `- ` bullet points for lists of actors, actions, or substates.

**Every transition must have a description.** No exceptions. For transitions with 2+ actions, use bullet points: summary sentence, blank line, "Actions:" header, then `- actionName: what it does` for each. This is the gold standard — the `user.expandSession` pattern.

**`onDone`, `onError`, `onSnapshot`, `always`, `after` all get descriptions.** These are transitions too.

**Bullet points are the standard format.** The inspector renders `- ` as bullet points. They are far more readable than inline text. Use them for context field lists, action lists in transitions, actor/substate lists in states.

```typescript
createMachine({
  id: "sessions",
  description: [
    "Context:",
    "",
    "- sessions (Session[]): all known tmux sessions. Populated by fetcher on initial load...",
    "- expandedSessions (string[]): ordered list of session names with visible panels...",
    "- mountedTerminals (Record<string, terminalMachine actor>): map of session name → spawned child...",
  ].join("\n"),
  states: {
    browsing: {
      description: [
        "User is on the sessions page.",
        "",
        "Invokes sessionsSubscription — an observable actor subscribed to the /sessions WebSocket.",
        "",
        "onSnapshot runs two actions:",
        "- updateSessionsFromSnapshot: replaces sessions[] with latest WebSocket data",
        "- evictOfflineSessions: removes terminal actors for sessions that went offline",
      ].join("\n"),
    },
  },
})

"user.expandSession": {
  description: [
    "User clicked a session to expand its terminal panel.",
    "",
    "Actions:",
    "- cancelUnmountTimer: if this session had a pending 60s unmount timer, cancel it",
    "- spawnAndActivateTerminal: spawn a terminalMachine child actor, send parent.activate",
    "- addToExpanded: add session name to expandedSessions, record timestamp",
    "- setFocused: set this session as the focused/active panel",
    "- evictOldestCollapsed: if over MAX_MOUNTED (5), evict oldest collapsed terminal",
    "- bumpLayoutVersion: trigger panel re-measurement",
  ].join("\n"),
  target: "viewingSession",
  actions: [...],
}
```

**No code comments in machine files.** Comments are invisible in the inspector. Everything goes in `description` fields.

## Event Naming Convention

Events are namespaced by their source:

```typescript
"user.click"           // User-initiated action
"user.submit"          // Form submission
"user.cancel"          // User cancellation
"app.start"            // From parent machine
"app.updateSettings"   // Config broadcast from parent
"child.completed"      // From spawned child actor
"child.failed"         // Child actor error
"webSocket.connected"  // From infrastructure actor
"sys.activate"         // Page/tab activated
"sys.deactivate"       // Page/tab deactivated
```

**Rule:** The namespace tells you who initiated the event. This makes machine logic self-documenting.

## Root Machine + Actor Hierarchy

The root `appMachine` spawns domain machines and coordinates them:

```typescript
export const appMachine = setup({
  types: {
    context: {} as {
      featureRef: ActorRefFrom<typeof featureMachine>;
      settingsRef: ActorRefFrom<typeof settingsMachine>;
    },
  },
}).createMachine({
  id: "app",
  context: ({ spawn }) => ({
    featureRef: spawn(featureMachine, { input: { initialItems: [] } }),
    settingsRef: spawn(settingsMachine),
  }),
  // Root machine coordinates children, broadcasts settings updates
});
```

### Actor Communication

**Parent → Child:** `sendTo`
```typescript
entry: sendTo(({ context }) => context.childRef, { type: "app.activate" })
```

**Child → Parent:** `sendParent`
```typescript
onDone: { actions: sendParent({ type: "child.completed" }) }
```

**Direct (from hook/component):** `actorRef.send()`
```typescript
// Only use this in hooks, never in machines
context.featureRef.send({ type: "app.updateSettings", settings: newSettings });
```

## Context Setup — createActorContext

Use `createActorContext` from @xstate/react (replaces manual context boilerplate):

```typescript
// context/appContext.tsx
"use client";
import { createActorContext } from "@xstate/react";
import { appMachine } from "@/machines/appMachine";

export const AppMachineContext = createActorContext(appMachine);

// app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html><body>
      <AppMachineContext.Provider>
        {children}
      </AppMachineContext.Provider>
    </body></html>
  );
}
```

## Hook Pattern — The Bridge Layer

Every domain hook follows this exact structure:

```typescript
// hooks/useFeatureContext.ts
"use client";
import { useCallback, useMemo } from "react";
import { AppMachineContext } from "@/context/appContext";
import { convertStateToString } from "@/lib/stateToStr";
import { useToast } from "./useToast";

// State enum — maps nested machine states to simple UI states
export enum FeatureState {
  Idle = "Idle",
  Loading = "Loading",
  Editing = "Editing",
  Error = "Error",
}

const stateMap: Record<string, FeatureState> = {
  "idle": FeatureState.Idle,
  "loading": FeatureState.Loading,
  "editing.form": FeatureState.Editing,
  "editing.submitting": FeatureState.Loading,
  "error": FeatureState.Error,
};

export const useFeatureContext = () => {
  // 1. Get actor reference
  const appActorRef = AppMachineContext.useActorRef();
  const featureRef = AppMachineContext.useSelector((s) => s.context.featureRef);

  // 2. Fine-grained selectors (prevent over-rendering)
  const items = useSelector(featureRef, (s) => s?.context.items ?? []);
  const selectedId = useSelector(featureRef, (s) => s?.context.selectedId ?? null);
  const stateValue = useSelector(featureRef, (s) => s?.value);

  // 3. Toast notifications
  useToast(featureRef);

  // 4. Map machine state to UI enum
  const featureState = useMemo(() => {
    if (!stateValue) return FeatureState.Idle;
    return stateMap[convertStateToString(stateValue)] ?? FeatureState.Idle;
  }, [stateValue]);

  // 5. Dispatch wrapper
  const dispatch = useCallback(
    (event: any) => featureRef?.send(event),
    [featureRef]
  );

  // 6. Return structured object — ALWAYS this shape
  return {
    state: { featureState },
    data: {
      items,
      selectedItem: items.find((i) => i.id === selectedId) ?? null,
    },
    actions: {
      select: {
        item: (id: string) => dispatch({ type: "user.select", id }),
      },
      submit: {
        create: (data: CreateInput) => dispatch({ type: "user.create", data }),
        update: (id: string, data: UpdateInput) => dispatch({ type: "user.update", id, data }),
        delete: (id: string) => dispatch({ type: "user.delete", id }),
      },
      cancel: {
        edit: () => dispatch({ type: "user.cancelEdit" }),
      },
    },
  };
};

// Export types for component props
export type FeatureData = ReturnType<typeof useFeatureContext>["data"];
export type FeatureActions = ReturnType<typeof useFeatureContext>["actions"];
```

### Hook Rules

1. **Always return `{ state, data, actions }`.** This is the contract between hooks and components.
2. **Group actions semantically:** `select`, `submit`, `cancel`, `close`, `refresh`. Not flat.
3. **Use `useSelector` for fine-grained subscriptions.** Don't select the entire snapshot and destructure — that causes re-renders on any change.
4. **Export return types** so components can type their props from the hook.
5. **Map machine states to enums.** Components should never parse machine state strings.

## Component Patterns

### Container Components (use hooks)

```typescript
"use client";
import { useFeatureContext, FeatureState } from "@/hooks/useFeatureContext";

export function FeatureSection() {
  const { state, data, actions } = useFeatureContext();

  // Only local UI state here (filters, toggles — NOT business state)
  const [filter, setFilter] = useState("");

  // Derived/filtered data
  const filteredItems = useMemo(
    () => data.items.filter((i) => i.name.includes(filter)),
    [data.items, filter]
  );

  // State-driven rendering
  switch (state.featureState) {
    case FeatureState.Loading:
      return <LoadingSkeleton />;
    case FeatureState.Error:
      return <ErrorDisplay onRetry={actions.refresh} />;
    default:
      return (
        <div>
          <SearchInput value={filter} onChange={setFilter} />
          <ItemList items={filteredItems} onSelect={actions.select.item} />
        </div>
      );
  }
}
```

### Presentational Components (props only)

```typescript
import { memo } from "react";
import type { FeatureData, FeatureActions } from "@/hooks/useFeatureContext";

interface ItemListProps {
  items: FeatureData["items"];
  onSelect: FeatureActions["select"]["item"];
}

export const ItemList = memo(function ItemList({ items, onSelect }: ItemListProps) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id} onClick={() => onSelect(item.id)}>{item.name}</li>
      ))}
    </ul>
  );
});
```

### Component Rules

1. **Container components call hooks.** They orchestrate layout and delegate to presentational components.
2. **Presentational components receive everything via props.** No hooks, no imports from machines or data.
3. **Type props from hook return types.** `FeatureData["items"]` stays in sync automatically.
4. **Only `useState` for local UI state** in components (filter text, open/closed toggle, selected tab, sort order). These are view preferences that don't affect machine logic — filtering a list is selecting which subset to render, not changing data.
5. **No `useEffect` for data fetching.** Machines handle all data lifecycle via `invoke` + `fromPromise` / `fromObservable`.

## Type System

### Every Domain Machine Gets Its Own Type File — Hard Constraint

Every domain machine MUST have a dedicated type definition file at `types/{domain}.ts`. Types used across the domain — by the machine, its child machines, hooks, and components — are defined there and imported from the `@/types` barrel.

**What goes in `types/{domain}.ts`:**
- Core data types for the domain (e.g., `Session`, `PipelineTrace`)
- Shared enums and union types (e.g., `AgentState`, `FilterMode`)
- Child machine context types that hooks need to access (e.g., `StartSessionContext`)
- Types shared between machine and components (e.g., `SavedConfig`)

**What stays inline in the machine file:**
- `Events` union — private to the machine, no external consumer
- Machine context interface — if only the machine uses it (hooks use `useSelector` on individual fields)

**What NEVER happens:**
- Defining a type in two places (machine AND component) — extract to types file
- Putting domain types in `types/index.ts` catch-all — each domain owns its types
- Using `any` or `as unknown as` to access child machine context — export the context type

```
types/
├── index.ts          # Barrel: re-exports all domain types, plus truly shared types
├── assistant.ts      # Stream events, message records, session types
├── sessions.ts       # Session, AgentState, SavedConfig, StartSessionContext
├── mirror.ts         # Debug events, PipelineTrace, BackendTrace
├── meetings.ts       # Room, transcript, participant types
└── ...               # One file per domain machine
```

**The barrel (`types/index.ts`)** re-exports everything via `export * from "./sessions"` etc. Consumers always import from `@/types`, never from `@/types/sessions` directly. The barrel also holds truly cross-domain types that don't belong to any single machine (e.g., `EntityName`, `ViewMode`).

**Child machine context export pattern:**

```typescript
// types/sessions.ts — export the context shape
export interface StartSessionContext {
  offlineAgents: Session[];
  selectedAgents: string[];
  runtimeAssignments: Record<string, string>;
  // ...
}

// machines/startSessionMachine.ts — import and use
import type { StartSessionContext } from "@/types";

export const startSessionMachine = setup({
  types: { context: {} as StartSessionContext },
  // ...
})

// hooks/useStartSessionContext.ts — import for typed selectors
import type { StartSessionContext } from "@/types";
// Now useSelector has proper types instead of `any`
```

### Zod Schema → TypeScript Type

```typescript
// types/featureTypes.ts
import { z } from "zod";

export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "inactive"]),
  createdAt: z.string().datetime(),
});

export type Item = z.infer<typeof ItemSchema>;

// Variants for different operations
export const CreateItemSchema = ItemSchema.omit({ id: true, createdAt: true });
export type CreateInput = z.infer<typeof CreateItemSchema>;

export const UpdateItemSchema = ItemSchema.partial().required({ id: true });
export type UpdateInput = z.infer<typeof UpdateItemSchema>;
```

### Actor Reference Types

```typescript
import { ActorRefFrom } from "xstate";

type FeatureRef = ActorRefFrom<typeof featureMachine>;
type SettingsRef = ActorRefFrom<typeof settingsMachine>;

// For polymorphic actors (multiple machine types)
type AnyDomainRef = ActorRefFrom<typeof featureAMachine | typeof featureBMachine>;
```

## Async Operations

### API Calls — fromPromise

```typescript
actors: {
  fetcher: fromPromise(async ({ input }: { input: { id: string } }) => {
    const response = await fetch(`/api/items/${input.id}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return ItemSchema.parse(await response.json());
  }),
},

// Usage in state
loading: {
  invoke: {
    src: "fetcher",
    input: ({ context }) => ({ id: context.selectedId! }),
    onDone: { target: "idle", actions: assign({ item: ({ event }) => event.output }) },
    onError: { target: "error", actions: "notifyError" },
  },
},
```

### Live Data Subscriptions — fromObservable + onSnapshot

For real-time data (WebSocket, SSE, event streams), use `fromObservable`. The observable's emitted value becomes the actor's snapshot. The parent machine reacts via `onSnapshot` on the invoke — **no events needed**. Data flows through the actor model, not through the event system.

```typescript
import { fromObservable, type Subscribable } from "xstate";
import { createSessionsSocket } from "@/lib/sessions-socket";

actors: {
  sessionsSubscription: fromObservable<Session[], void>(() => ({
    subscribe(observer) {
      const socket = createSessionsSocket();
      socket.on("sessions:update", (data: Session[]) => {
        observer.next?.(data);
      });
      socket.connect();
      return { unsubscribe() { socket.disconnect(); } };
    },
  } as Subscribable<Session[]>)),
},

// In the state that needs live data:
browsing: {
  invoke: {
    src: "sessionsSubscription",
    onSnapshot: {
      actions: ["updateDataFromSnapshot", "reactToChanges"],
    },
  },
  // on: { ... } — only user actions and system transitions, NO data events
}
```

**Why not `fromCallback` + `sendBack`?** `fromCallback` sends events that pollute the Events union, require explicit handlers in the `on` block, and create the XState 5 re-entry problem (parent-level targetless handlers re-enter the initial child state). `fromObservable` with `onSnapshot` avoids all of this — data flows silently through the actor snapshot.

**Why not polling?** Polling wastes requests, adds latency, and requires interval management. Use WebSocket/SSE push from the backend. If the backend doesn't support push yet, file an issue — don't build polling as a "temporary" solution.

### Primitive Selection Guide

| Need | Primitive | Why |
|------|-----------|-----|
| One-shot async (API call, file read) | `fromPromise` | Returns once, fits `onDone`/`onError` |
| Live data stream (WebSocket, SSE) | `fromObservable` + `onSnapshot` | Continuous values, no events needed |
| Side-effect lifecycle (timer, listener) | `fromCallback` | Setup + cleanup, sends events for specific interactions |
| Child state machine | `spawn` or `invoke` with machine | Complex stateful child with its own transitions |

## Toast/Notification Hook

```typescript
// hooks/useToast.ts
import { useEffect } from "react";
import { toast } from "sonner";

export const useToast = (actorRef: any) => {
  useEffect(() => {
    if (!actorRef) return;
    const sub = actorRef.on("notification", (event: any) => {
      const { type, message } = event.data;
      switch (type) {
        case "success": toast.success(message); break;
        case "error": toast.error(message); break;
        case "info": toast.info(message); break;
        case "warning": toast.warning(message); break;
      }
    });
    return () => sub.unsubscribe();
  }, [actorRef]);
};
```

## New Feature Checklist

When adding a new feature domain:

1. **Types** — Create `types/{domain}.ts` with all domain data types, child machine context types, and shared enums. Add `export * from "./{domain}"` to `types/index.ts`. This is the foundation — everything else imports from here.
2. **Machine** — Define in `machines/`, use `setup()` pattern with types from step 1, add to appMachine as spawned child. Machine-internal `Events` and context stay inline.
3. **Hook** — Create in `hooks/`, return `{ state, data, actions }`, import types from `@/types` for child context access, subscribe to notifications
4. **Components** — Container in `components/{feature}/`, presentational as needed. Import shared types from `@/types`, never define domain types locally.
5. **Page** — Wire into App Router if it's a new route
6. **Barrel exports** — Verify `types/index.ts` re-exports the new domain types

## Machine Design Principles

### State Is the Source of Truth — Never Duplicate It in Context

The machine's current state node already encodes where the user is. **Never store a context boolean that mirrors state.** If you're in the `browsing` state, the tab is active. If you're in `inactive`, it's not. A context flag like `isTabActive` duplicates this and creates divergence risk.

**Wrong:** Guard on `isTabActive` context flag to decide which state to enter after an async operation.
**Right:** Handle the competing event (`sys.deactivate`) as a real state transition that cancels the in-flight operation. XState auto-cancels invocations when you leave a state — use that.

```typescript
// WRONG — context boolean duplicating state
loading: {
  invoke: {
    src: "fetcher",
    onDone: [
      { guard: "isTabActive", target: "browsing" },  // flag-based routing
      { target: "inactive" },
    ],
  },
  on: {
    "sys.deactivate": { actions: "markTabInactive" },  // just sets a flag
  },
}

// RIGHT — state handles it directly
loading: {
  invoke: {
    src: "fetcher",
    onDone: { target: "browsing", actions: "setSessions" },  // always goes to browsing
    onError: { target: "error", actions: "setLoadError" },
  },
  on: {
    "sys.deactivate": { target: "inactive" },  // real transition, fetch auto-canceled
  },
}
```

### No Speculative Events or Transitions

Every event in the machine must correspond to something that **actually gets sent** by a real caller today. Don't add events for hypothetical future use cases.

- If nothing sends `sys.refresh`, don't define it
- If nothing sends `sys.load` and `sys.activate` does the same thing, don't have both
- "Maybe we'll want this later" is not justification — add it when a caller exists

**Test:** For every event in your Events union, you should be able to point to the exact line of code that sends it. If you can't, it's dead code.

### Error States Should Auto-Retry

Don't make the user click a retry button as the first response to a transient failure. Use XState's `after` for automatic retry with a count limit, then fall back to manual retry:

```typescript
error: {
  initial: "retrying",
  on: {
    "sys.deactivate": { target: "inactive" },  // parent-level, works from both substates
  },
  states: {
    retrying: {
      always: {
        guard: "retriesExhausted",
        target: "failed",
      },
      after: {
        3000: {
          target: "#machine.loading",
          actions: "incrementRetry",
        },
      },
    },
    failed: {
      on: {
        "user.retry": {
          target: "#machine.loading",
          actions: "resetRetryCount",
        },
      },
    },
  },
}
```

### Preserve User Selections Across Navigation

When the user navigates away from a page and comes back, their selections (expanded items, focused item, scroll position) should survive the round-trip. Stop live connections (WebSocket, terminal actors) on deactivate, but **don't reset the user's UI state**. On reactivation, respawn the connections using the preserved selection.

### Use the Right Actor Primitive

Every actor type exists for a reason. Using the wrong one creates workarounds that compound as the machine grows:

- **`fromPromise`** — one-shot async operations (API calls). Returns once via `onDone`/`onError`.
- **`fromObservable`** — continuous data streams (WebSocket, SSE). Data flows through `onSnapshot` on the invoke. **No events needed** in the Events union — the observable's snapshot IS the data.
- **`fromCallback`** — side-effect lifecycle (setup + cleanup) that sends specific interaction events back. Use for things like keyboard listeners, timers with user-triggered actions.
- **Child machines** — complex stateful children with their own transitions (e.g., terminal sessions).

**The test:** If your `fromCallback` actor only does `sendBack({ type: "data", ... })` on every emission, it should be a `fromObservable` with `onSnapshot`. If your `fromObservable` needs to send different event types, it should be a `fromCallback`.

### No Hidden State Transitions — The State Chart Must Be Honest

Every state transition in the machine must represent a **meaningful domain event** that the machine actively participates in. If a library handles something transparently (Socket.IO auto-reconnection, HTTP retry middleware, browser refocus), the state machine must NOT have states that mirror this invisible process.

**The violation:** A `reconnecting` state that the machine enters on transport disconnect, where the machine does nothing except wait for the transport library to reconnect. The state chart shows a transition the machine doesn't control — it's ceremony, not logic.

**The principle:** If a transient event is handled entirely by a lower layer (transport, browser, OS), the state machine should not know about it. The machine stays in its current state. Only when the lower layer **fails definitively** should the machine transition — to an error state that requires real action.

```
// WRONG — machine mirrors transport internals
connected → socket.disconnected → reconnecting → socket.connected → connected
// The machine did nothing in "reconnecting" — Socket.IO handled it

// RIGHT — machine only reacts to meaningful outcomes
connected → (transport handles blips invisibly) → stays connected
connected → transport gave up entirely → error (real failure, needs action)
```

**How to detect this:** If a state exists where the machine's only transition OUT is waiting for an external system to send a success event, and the machine performs no actions, retries, or decisions in that state — the state is hidden ceremony. Remove it and let the external system handle its own resilience.

### No Passthrough Forwarding — Components Talk to the Right Actor

If a component sends an event to Machine A, and Machine A's only action is to forward it identically to Machine B (a child actor), the component should send directly to Machine B. The intermediate machine adds nothing — it's useless complexity.

**The test:** Remove the forwarding handler. Does any logic break? If the machine only does `sendTo(childRef, event)` with no state change, no guard, no additional actions — the event doesn't belong in that machine.

**Exception:** When a PARENT machine (not a component) sends an event that gets forwarded to a grandchild, that's the actor hierarchy working correctly. The parent shouldn't reach into a child's context to access a grandchild — it sends to the child, which forwards. This is encapsulation, not passthrough.

**How components access child actors:** The hook exposes the child actor ref (e.g., `socketRef` from the terminal machine's context via `useSelector`). The component sends flow-control commands directly to the socket. The terminal machine handles lifecycle events (activate, deactivate, connect) where it makes actual decisions.

### Transport Resilience Belongs in the Transport Layer

Socket.IO reconnection, HTTP retry, WebSocket ping/pong, TCP keepalive — these are transport concerns. The state machine represents **user flow and domain logic**, not transport protocol internals.

- Configure transport resilience in the transport layer (Socket.IO `reconnectionAttempts`, `reconnectionDelay`, etc.)
- The machine's `fromCallback` or `fromObservable` actors absorb transient transport events
- Only surface transport failure to the machine when recovery is impossible and user action is needed

### Context Is for Domain Data — Not View Filters

Machine context stores data that drives transitions, guards, and actions — not UI display preferences. If a value only affects **which subset of data is rendered** without affecting any machine logic, it belongs in the component as `useState`.

**Wrong:** `searchQuery` in machine context with a `user.setSearchQuery` event — the machine stores it but never uses it for transitions or guards.
**Right:** `useState` in the component. The component filters the data array locally before rendering.

**The test:** Remove the context field. Does any guard, action, or transition break? If not, it doesn't belong in the machine.

## Machine Review Checklist

When reviewing or auditing a state machine, evaluate in this order:

1. **Machine description** — does it document every context field? (What it holds, why it exists, what updates it)
2. **Top-level states first** — understand the lifecycle before diving into substates
3. **Description completeness** — does every state, every transition, every `onDone`/`onError`/`onSnapshot`/`always`/`after` have a description?
4. **State transitions** — map every `From → Event → To` with actions. Classify each as "transition" (changes state) or "data-only" (updates context, stays in same state)
5. **Context audit** — for every context field, ask: "Is this duplicating state?" and "Does any guard, action, or transition use this?" If it only affects rendering, it belongs in the component as `useState`
6. **Event audit** — for every event in the Events union, ask: "What code sends this?" If nothing, remove it
7. **Actor primitive audit** — is each actor using the right primitive? Subscriptions should be `fromObservable` + `onSnapshot`, not `fromCallback` + `sendBack`
8. **Guard audit** — are all guards named? No inline anonymous functions
9. **Error handling** — does every error state auto-retry before requiring user action?
10. **Navigation preservation** — does deactivate/reactivate preserve user selections?
11. **No code comments** — all documentation lives in `description` fields, not comments
12. **Then** go one level deeper into substates and repeat

## Anti-Patterns — Hard Blocks

| Anti-Pattern | Why It's Wrong | Correct Pattern |
|---|---|---|
| Context boolean duplicating state | State divergence, guard complexity | Use state nodes — if you're in `browsing`, tab is active |
| Speculative events | Dead code, misleading machine definition | Only define events that have a real sender today |
| Manual-only error retry | Bad UX, user shouldn't fix transient failures | Auto-retry with `after`, manual fallback after N attempts |
| Aggressive teardown on deactivate | Loses user's place, frustrating UX | Stop connections, preserve selections |
| Multiple events for same transition | Confusing, redundant | One event per unique transition path |
| View filters in machine context | Bloats context, unnecessary events | `useState` in component — filter locally |
| `fromCallback` for data subscriptions | Pollutes Events union, requires handlers | `fromObservable` + `onSnapshot` — no events |
| Polling with `setInterval` | Wasted requests, latency, complexity | WebSocket/SSE push with `fromObservable` |
| Inline anonymous guards | Unreadable in inspector and code review | Named guards in `setup({ guards: { ... } })` |
| Business logic in components | Untestable, duplicated | Move to machines |
| Importing machines in components | Couples UI to state implementation | Use hooks as bridge |
| `useState` for server/shared state | State diverges, no single source of truth | Machine context |
| `useEffect` for data fetching | Race conditions, cleanup bugs | Machine `invoke` + `fromPromise` |
| Flat action names in hooks | Hard to discover, collisions | Grouped: `actions.submit.create()` |
| Selecting entire machine snapshot | Over-rendering on any change | Fine-grained `useSelector` |
| State string comparisons in components | Fragile, no autocomplete | Map to enums in hooks |
| Missing `onError` in invoke | Silent failures | Always handle errors |
| `useEffect` to sync state between React and XState | Creates infinite loops, timing issues | Let XState own the state, React reads via selectors |
| Code comments in machine files | Invisible in inspector, stale documentation | Use `description` fields on states/transitions |
| Domain types in catch-all `index.ts` | Unreadable, types get lost among unrelated definitions | Each domain machine gets `types/{domain}.ts` |
| Same type defined in two files | Drift risk, maintenance burden | Single source in `types/{domain}.ts`, import everywhere |
| `any` for child machine context | Loses type safety, hides bugs | Export context type from `types/{domain}.ts`, import in hooks |
| State that mirrors transport internals | Machine does nothing in that state — it's ceremony | Let transport layer handle resilience; only transition on definitive failure |
| `reconnecting` state where machine just waits | Hidden transition the machine doesn't control | Stay in current state; transport retries invisibly; transition to `error` only on total failure |
| Passthrough forwarding events | Machine adds no logic, just routes to child | Component sends directly to the child actor via hook-exposed ref |
| Machine description explaining lifecycle | Useless — lifecycle is visible in the inspector | Machine description documents context fields |
| Transitions without descriptions | Forces reading code to understand the machine | Every transition gets a description, no exceptions |
| Context fields without documentation | Inspector shows names/values but no explanation | Document every field in machine-level `description` |

## Modern Patterns (XState 5.20+)

### createActorContext (replaces manual context)
Shown above. Preferred for all new code.

### setup.extend() — composable configurations
```typescript
const baseSetup = setup({ guards: { isAuth: ({ context }) => !!context.user } });
const featureSetup = baseSetup.extend({ guards: { canEdit: and(["isAuth", "hasPermission"]) } });
```

### Tags — declarative state categorization
```typescript
states: {
  fetching: { tags: ["loading"] },
  retrying: { tags: ["loading"] },
  success: { tags: ["ready"] },
}
// In hook: snapshot.hasTag("loading") instead of state value comparison
```

### enqueueActions — conditional action logic
```typescript
entry: enqueueActions(({ context, enqueue, check }) => {
  enqueue.assign({ lastUpdate: Date.now() });
  if (check("isAuth")) {
    enqueue.emit({ type: "notification", data: { type: "info", message: "Updated" } });
  }
});
```

## Tech Stack (2026 recommended)

| Library | Version | Purpose |
|---|---|---|
| Next.js | 16.x | App Router, Turbopack |
| React | 19.x | UI rendering |
| XState | 5.25+ | State machines, actor model |
| @xstate/react | 6.x | React bindings, createActorContext |
| Zod | 3.24+ | Schema validation, type inference |
| shadcn/ui | latest | UI component primitives |
| Tailwind CSS | 4.x | Utility-first styling |
| sonner | 1.x | Toast notifications |
| lucide-react | latest | Icons |
