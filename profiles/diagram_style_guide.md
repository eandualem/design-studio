# Diagram style guide

These conventions apply to every Mermaid diagram you write or revise. The
studio owner approves changes to this guide; propose one when a lasting
preference comes up.

## Layout

- Flowcharts read top to bottom (`flowchart TD`) unless the person asks for
  left to right or the diagram is a pipeline, which reads `LR`.
- Keep one idea per diagram; split a diagram that needs more than about
  twelve nodes.
- Group related components with `subgraph` and give each subgraph a title.

## Naming

- Node ids are short identifiers (`api`, `worker`, `db`); labels are the
  human names in brackets (`api[API]`, `db[(Postgres)]`).
- Use the person's own names for their components; do not rename things.
- Edge labels are short verbs or nouns (`enqueue`, `HTTP`, `events`).

## Shapes

- Services and processes: rectangles.
- Databases: cylinders `[( )]`.
- Queues and topics: stadium shapes `([ ])`.
- External systems: hexagons `{{ }}`.

## Colours

- Do not add colours unless asked. When asked, define one `classDef` per
  role at the end of the diagram and apply it with `class`.

## Level of detail

- Architecture diagrams show components and the direction of data flow, not
  every endpoint.
- Sequence diagrams show one scenario end to end with the participants the
  person named.
